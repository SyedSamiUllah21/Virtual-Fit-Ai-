"""
============================================================================
Fashion Recommendation Engine - Backend API
============================================================================
Author: Senior Backend Architect
Date: 2026-02-12
Description: Flask-based REST API with size calculation logic and recommendation engine
============================================================================
"""

import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import pymysql
import pymysql.cursors
from pymysql import Error
import hashlib
import uuid
import json
import io
import base64
import urllib.request
import re
import math
from datetime import datetime
from typing import Dict, List, Tuple, Optional
from dotenv import load_dotenv

ENV_FILE_PATH = os.path.join(os.path.dirname(__file__), '.env')

# Always prefer values from project .env over inherited shell/system vars.
load_dotenv(dotenv_path=ENV_FILE_PATH, override=True)

# --- Universal AI Helper ---
# Provider is controlled by LLM_PROVIDER in Code/.env (openrouter|groq).
GROQ_MODEL = os.getenv("GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
OPENROUTER_TEXT_MODEL = os.getenv("OPENROUTER_TEXT_MODEL", "meta-llama/llama-3.3-70b-instruct")
OPENROUTER_VISION_MODEL = os.getenv("OPENROUTER_VISION_MODEL", "qwen/qwen2.5-vl-72b-instruct")


def _messages_include_image(messages) -> bool:
    if not isinstance(messages, list):
        return False

    for msg in messages:
        content = msg.get('content') if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and str(part.get('type') or '').strip().lower() == 'image_url':
                return True
    return False


def _call_groq_with_model(api_key, model, messages, max_tokens, timeout_sec):
    import http.client
    import ssl

    payload = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens
    }).encode("utf-8")

    ssl_ctx = ssl.create_default_context()
    conn = http.client.HTTPSConnection("api.groq.com", 443, context=ssl_ctx, timeout=timeout_sec)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "VTONX/1.0 Python"
    }

    conn.request("POST", "/openai/v1/chat/completions", body=payload, headers=headers)
    resp = conn.getresponse()
    raw = resp.read().decode("utf-8")
    conn.close()
    return resp.status, raw


def _call_openrouter_with_model(api_key, model, messages, max_tokens, timeout_sec):
    import http.client
    import ssl

    payload = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens
    }).encode("utf-8")

    ssl_ctx = ssl.create_default_context()
    conn = http.client.HTTPSConnection("openrouter.ai", 443, context=ssl_ctx, timeout=timeout_sec)

    app_url = (os.getenv("OPENROUTER_SITE_URL") or "http://localhost:3000").strip()
    app_name = (os.getenv("OPENROUTER_APP_NAME") or "Virtual Fit AI Studio").strip()

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": app_url,
        "X-Title": app_name,
        "User-Agent": "VTONX/1.0 Python"
    }

    conn.request("POST", "/api/v1/chat/completions", body=payload, headers=headers)
    resp = conn.getresponse()
    raw = resp.read().decode("utf-8")
    conn.close()
    return resp.status, raw


def _is_retryable_llm_error(status: int, raw: str) -> bool:
    if status in {500, 502, 503, 504}:
        return True

    if status == 429:
        body = (raw or "").lower()
        non_retry_markers = [
            "free-models-per-day",
            "insufficient credits",
            "insufficient_credit",
            "insufficient_quota",
            "insufficient_balance",
            "quota",
            "credit",
        ]
        return not any(marker in body for marker in non_retry_markers)

    return False

def call_groq(messages, max_tokens=500, force_model=None, force_timeout_sec=None, force_max_attempts=None):
    """
    Universal AI call via configured provider (OpenRouter or Groq).
    Uses http.client with explicit SSL to avoid Windows urllib DNS/getaddrinfo issues.
    """
    provider = (os.getenv("LLM_PROVIDER") or "openrouter").strip().lower()
    is_vision_request = _messages_include_image(messages)

    if provider == 'openrouter':
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY not configured in .env")

        if is_vision_request:
            preferred_model = (os.getenv("OPENROUTER_VISION_MODEL") or os.getenv("OPENROUTER_MODEL") or OPENROUTER_VISION_MODEL).strip()
            configured_models_raw = os.getenv("OPENROUTER_VISION_MODEL_CANDIDATES", "")
            if not configured_models_raw.strip():
                configured_models_raw = os.getenv("OPENROUTER_MODEL_CANDIDATES", "")
        else:
            preferred_model = (os.getenv("OPENROUTER_TEXT_MODEL") or os.getenv("OPENROUTER_MODEL") or OPENROUTER_TEXT_MODEL).strip()
            configured_models_raw = os.getenv("OPENROUTER_TEXT_MODEL_CANDIDATES", "")
            if not configured_models_raw.strip():
                configured_models_raw = os.getenv("OPENROUTER_MODEL_CANDIDATES", "")

        provider_label = "OpenRouter"
        call_with_model = _call_openrouter_with_model
        retries_env_key = "OPENROUTER_MAX_RETRIES"
        retry_base_env_key = "OPENROUTER_RETRY_BASE_SEC"
        timeout_env_key = "OPENROUTER_REQUEST_TIMEOUT_SEC"
    else:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY not configured in .env")

        preferred_model = (os.getenv("GROQ_MODEL") or GROQ_MODEL or "meta-llama/llama-4-scout-17b-16e-instruct").strip()
        configured_models_raw = os.getenv("GROQ_MODEL_CANDIDATES", "")
        provider_label = "Groq"
        call_with_model = _call_groq_with_model
        retries_env_key = "GROQ_MAX_RETRIES"
        retry_base_env_key = "GROQ_RETRY_BASE_SEC"
        timeout_env_key = "GROQ_REQUEST_TIMEOUT_SEC"

    configured_models = [m.strip() for m in configured_models_raw.split(",") if m.strip()]
    model_candidates = []
    forced = (force_model or '').strip()
    model_seed = ([forced] if forced else []) + [preferred_model] + configured_models
    for model in model_seed:
        if model and model not in model_candidates:
            model_candidates.append(model)

    if not model_candidates:
        model_candidates = [preferred_model]

    import time as _time

    try:
        max_attempts = max(1, int(os.environ.get(retries_env_key, "2")))
    except ValueError:
        max_attempts = 2

    if force_max_attempts is not None:
        try:
            max_attempts = max(1, int(force_max_attempts))
        except Exception:
            pass

    try:
        retry_base_sec = max(0.3, float(os.environ.get(retry_base_env_key, "0.7")))
    except ValueError:
        retry_base_sec = 0.7

    try:
        timeout_sec = max(2, int(os.environ.get(timeout_env_key, "18")))
    except ValueError:
        timeout_sec = 18

    if force_timeout_sec is not None:
        try:
            timeout_sec = max(2, int(float(force_timeout_sec)))
        except Exception:
            pass

    last_error = None

    for model in model_candidates:
        for attempt in range(max_attempts):
            try:
                status, raw = call_with_model(api_key, model, messages, max_tokens, timeout_sec)
            except Exception as call_err:
                last_error = f"{provider_label} request error ({model}): {call_err}"
                if attempt < max_attempts - 1:
                    _time.sleep(retry_base_sec * (attempt + 1))
                    continue
                break

            if status == 200:
                data = json.loads(raw)
                choices = data.get("choices") or []
                if not choices:
                    raise Exception(f"{provider_label} returned no choices")
                message = choices[0].get("message") or {}
                content = message.get("content")
                if isinstance(content, list):
                    text_chunks = []
                    for part in content:
                        if isinstance(part, dict) and isinstance(part.get("text"), str):
                            text_chunks.append(part.get("text"))
                    content = "\n".join([chunk for chunk in text_chunks if chunk]).strip()
                if not isinstance(content, str):
                    content = str(content or "").strip()
                return content

            last_error = f"{provider_label} HTTP {status} ({model}): {raw[:300]}"
            if _is_retryable_llm_error(status, raw) and attempt < max_attempts - 1:
                _time.sleep(retry_base_sec * (attempt + 1))
                continue
            break

    if last_error:
        raise Exception(last_error)
    raise Exception(f"{provider_label} request failed after retries.")


def refresh_env() -> None:
    """Reload project environment variables so recent .env edits are picked up."""
    load_dotenv(dotenv_path=ENV_FILE_PATH, override=True)


app = Flask(__name__)


def build_allowed_cors_origins() -> List[str]:
    """Build allowed CORS origins from env plus practical local-network defaults."""
    allowed = set()

    configured = os.getenv('CORS_ORIGINS', '')
    for origin in configured.split(','):
        item = origin.strip()
        if item:
            allowed.add(item)

    # Always allow common local dev ports, including Vite fallback port 3001.
    local_ports = [3000, 3001, 3005, 5173]
    for port in local_ports:
        allowed.add(f'http://localhost:{port}')
        allowed.add(f'http://127.0.0.1:{port}')
        allowed.add(rf'http://192\.168\.\d{{1,3}}\.\d{{1,3}}:{port}')
        allowed.add(rf'http://10\.\d{{1,3}}\.\d{{1,3}}\.\d{{1,3}}:{port}')
        allowed.add(rf'http://172\.(1[6-9]|2\d|3[0-1])\.\d{{1,3}}\.\d{{1,3}}:{port}')

    return sorted(allowed)


CORS(app, resources={r"/*": {"origins": ["https://virtual-fit-ai-mocha.vercel.app", "http://localhost:3000"]}})

# ============================================================================
# DATABASE CONFIGURATION
# ============================================================================

DB_CONFIG = {
    'host': 'mysql-30df46ff-syedsamiullah596-5ea5.d.aivencloud.com',
    'user': 'avnadmin',
    'password': os.getenv('DB_PASSWORD'),
    'database': 'defaultdb',
    'port': 26553,
    'ssl': {}
}


def get_db_connection():
    """Create and return a database connection."""
    try:
        connection = pymysql.connect(**DB_CONFIG)
        return connection
    except Error as e:
        print(f"Database connection error: {e}")
        return None

def get_weight_size(weight_kg: float) -> str:
    """Helper to get size based on weight only"""
    if weight_kg < 61:
        return 'S'
    elif weight_kg < 76:
        return 'M'
    elif weight_kg < 91:
        return 'L'
    else:
        return 'XL'

def get_height_size(height_ft: float) -> str:
    """Helper to get size based on height only"""
    if height_ft < 5.4:   # Up to ~5'4.8"
        return 'S'
    elif height_ft < 5.75: # Up to 5'9"
        return 'M'
    elif height_ft < 6.1:  # Up to 6'1.2"
        return 'L'
    else:
        return 'XL'

def calculate_size(weight_kg: float, height_ft: float) -> str:
    """
    Calculate clothing size based on weight and height.
    CRITICAL RULE: Return the LARGER size.
    """
    SIZE_HIERARCHY = {'S': 0, 'M': 1, 'L': 2, 'XL': 3}
    
    weight_size = get_weight_size(weight_kg)
    height_size = get_height_size(height_ft)
    
    # Return larger size
    if SIZE_HIERARCHY[weight_size] >= SIZE_HIERARCHY[height_size]:
        return weight_size
    else:
        return height_size

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def hash_password(password: str) -> str:
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

def parse_image_payload(image_value: str) -> Tuple[str, str]:
    """Extract mime type and base64 body from a data URI or plain base64 string."""
    default_mime = 'image/jpeg'

    if not isinstance(image_value, str):
        return default_mime, ''

    payload = image_value
    mime = default_mime

    if image_value.startswith('data:') and ',' in image_value:
        header, payload = image_value.split(',', 1)
        mime_candidate = header[5:].split(';', 1)[0].strip().lower()
        if mime_candidate.startswith('image/'):
            mime = mime_candidate

    # Ensure payload is correctly padded (multiple of 4 length)
    missing_padding = len(payload) % 4
    if missing_padding:
        payload += '=' * (4 - missing_padding)

    return mime, payload


def compact_image_for_validation(image_data_uri: str, max_side: int = 640, jpeg_quality: int = 72) -> str:
    """Downscale and JPEG-compress an image data URI to reduce vision inference latency."""
    try:
        mime, b64_payload = parse_image_payload(image_data_uri)
        if not b64_payload:
            return image_data_uri

        raw_bytes = base64.b64decode(b64_payload)
        from PIL import Image

        with Image.open(io.BytesIO(raw_bytes)) as image:
            image = image.convert('RGB')
            if max(image.size) > max_side:
                resample = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', Image.LANCZOS)
                image.thumbnail((max_side, max_side), resample)

            out = io.BytesIO()
            image.save(out, format='JPEG', quality=jpeg_quality, optimize=True)
            compact_b64 = base64.b64encode(out.getvalue()).decode('utf-8')
            return f'data:image/jpeg;base64,{compact_b64}'
    except Exception as err:
        print(f"[VTON] Validation image compaction skipped: {err}")
        return image_data_uri

def get_user_by_id(user_id: str) -> Optional[Dict]:
    """Retrieve user information by user_id"""
    connection = get_db_connection()
    if not connection:
        return None
    
    try:
        cursor = connection.cursor(pymysql.cursors.DictCursor)
        cursor.execute("SELECT * FROM Users WHERE user_id = %s", (user_id,))
        user = cursor.fetchone()
        return user
    except Error as e:
        print(f"Error fetching user: {e}")
        return None
    finally:
        cursor.close()
        connection.close()

def get_last_purchase(user_id: str) -> Optional[Dict]:
    """Get the most recent purchase for a user"""
    connection = get_db_connection()
    if not connection:
        return None
    
    try:
        cursor = connection.cursor(pymysql.cursors.DictCursor)
        query = """
            SELECT ph.*, c.category, c.item_name, c.gender
            FROM Purchase_History ph
            JOIN Clothing c ON ph.product_id = c.product_id
            WHERE ph.user_id = %s
            ORDER BY ph.purchase_date DESC
            LIMIT 1
        """
        cursor.execute(query, (user_id,))
        purchase = cursor.fetchone()
        return purchase
    except Error as e:
        print(f"Error fetching last purchase: {e}")
        return None
    finally:
        cursor.close()
        connection.close()


def build_chat_fallback_response(
    user_message: str,
    product_info: Optional[Dict],
    all_products: List[Dict],
    preferred_gender: Optional[str],
    history: Optional[List[Dict]] = None,
) -> str:
    """Return a concise fashion-only fallback response when LLM is unavailable."""
    message = (user_message or '').strip()
    lower_msg = message.lower()
    product_info = product_info or {}
    history = history or []

    fashion_keywords = {
        'shirt', 'tee', 't-shirt', 'top', 'blouse', 'jacket', 'coat', 'hoodie', 'sweater',
        'trouser', 'trousers', 'pants', 'jeans', 'bottom', 'bottoms', 'top', 'tops',
        'women', 'womens', 'women\'s', 'men', 'mens', 'men\'s',
        'fit', 'size', 'color', 'style',
        'outfit', 'clothes', 'clothing', 'wear', 'pair', 'match', 'catalog', 'available'
    }
    if not any(token in lower_msg for token in fashion_keywords):
        return 'I can only help with clothing and styling questions.'

    women_terms = {'women', 'womens', "women's", 'female', 'ladies', 'lady', 'girl', 'girls'}
    men_terms = {'men', 'mens', "men's", 'male', 'guys', 'gents', 'gentlemen', 'boy', 'boys'}
    upper_terms = {'upper', 'top', 'tops', 'shirt', 'tee', 't-shirt', 'jacket', 'hoodie', 'sweater', 'blouse'}
    bottom_terms = {'bottom', 'bottoms', 'pant', 'pants', 'trouser', 'trousers', 'chino', 'chinos', 'jean', 'jeans', 'skirt', 'shorts'}

    requested_gender = None
    if any(term in lower_msg for term in women_terms):
        requested_gender = 'Women'
    elif any(term in lower_msg for term in men_terms):
        requested_gender = 'Men'

    requested_category = None
    if any(term in lower_msg for term in bottom_terms):
        requested_category = 'Bottom'
    elif any(term in lower_msg for term in upper_terms):
        requested_category = 'Upper'

    effective_gender = requested_gender or preferred_gender
    products = [
        p for p in (all_products or [])
        if (not effective_gender or p.get('gender') == effective_gender)
    ]

    category_products = [
        p for p in products
        if (not requested_category or str(p.get('category') or '').lower() == requested_category.lower())
    ]

    fit_intent = any(k in lower_msg for k in ['fit', 'size', 'relaxed', 'slim', 'regular', 'tight', 'loose'])
    pair_intent = any(k in lower_msg for k in ['pair', 'match', 'go with', 'wear with', 'style with'])
    availability_intent = any(k in lower_msg for k in ['available', 'what else', 'show', 'catalog', 'list', 'options', 'more'])
    if not fit_intent and not pair_intent and (availability_intent or requested_category or requested_gender):
        source_products = category_products if category_products else products
        names = [str(p.get('item_name')).strip() for p in source_products if p.get('item_name')]
        mentioned = set()
        assistant_history = [h for h in history[-8:] if str(h.get('role', '')).lower() == 'assistant']
        for item_name in names:
            lowered_name = item_name.lower()
            for h in assistant_history:
                content = str(h.get('content') or '').lower()
                if lowered_name and lowered_name in content:
                    mentioned.add(lowered_name)

        unseen = [name for name in names if name.lower() not in mentioned]
        selected = (unseen[:4] if unseen else names[:4])
        if selected:
            if effective_gender == 'Women':
                gender_scope = "women's"
            elif effective_gender == 'Men':
                gender_scope = "men's"
            else:
                gender_scope = ''

            if requested_category == 'Bottom':
                category_scope = 'bottoms'
            elif requested_category == 'Upper':
                category_scope = 'tops'
            else:
                category_scope = 'items'

            scope = f"{gender_scope} {category_scope}".strip() if gender_scope else category_scope
            lead = f"Available {scope} include"
            if unseen and mentioned:
                lead = f"Other {scope} you can check are"
            return f"{lead} {', '.join(selected)}."
        return 'I can help with fit, styling, and available clothing items in this section.'

    current_category = str(product_info.get('category') or '').lower()
    current_id = product_info.get('product_id')
    target_category = None
    if current_category == 'upper':
        target_category = 'Bottom'
    elif current_category == 'bottom':
        target_category = 'Upper'

    pair_candidates = [
        p for p in products
        if p.get('product_id') != current_id
        and (not target_category or str(p.get('category') or '').lower() == target_category.lower())
    ]

    pair_item = pair_candidates[0] if pair_candidates else None
    current_name = product_info.get('item_name') or 'this item'

    if fit_intent:
        if 'relaxed' in lower_msg:
            fit_text = 'For a relaxed fit, size up if you want more room.'
        elif 'slim' in lower_msg:
            fit_text = 'For a slim fit, stay true to size or size down only if you prefer a tighter look.'
        else:
            fit_text = 'For a regular fit, stay true to size for balanced comfort.'

        if pair_item and pair_item.get('item_name'):
            return f"{fit_text} Pair {current_name} with {pair_item.get('item_name')} for a clean look."
        return f"{fit_text} I can also suggest matching tops or bottoms from this section."

    if pair_item and pair_item.get('item_name'):
        return f"Try pairing {current_name} with {pair_item.get('item_name')} for a balanced look."

    return 'I can suggest available tops, bottoms, and outfit pairings. Ask for examples like women\'s bottoms or men\'s tops.'

# ============================================================================
# API ENDPOINT 1: POST /calculate-size
# ============================================================================

@app.route('/calculate-size', methods=['POST'])
def calculate_size_endpoint():
    """
    Calculate and update user's size based on weight and height.
    """
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'weight' not in data or 'height' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: weight and height'
            }), 400
        
        weight_kg = float(data['weight'])
        height_ft = float(data['height'])
        user_id = data.get('user_id')
        
        # Validate ranges
        if weight_kg <= 0 or height_ft <= 0:
            return jsonify({
                'success': False,
                'error': 'Weight and height must be positive values'
            }), 400
        
        # Calculate size using the universal size chart logic
        calculated_size = calculate_size(weight_kg, height_ft)
        
        # If user_id provided, update the database
        if user_id:
            connection = get_db_connection()
            if connection:
                try:
                    cursor = connection.cursor()
                    update_query = """
                        UPDATE Users 
                        SET weight_kg = %s, height_ft = %s, calculated_size = %s, updated_at = %s
                        WHERE user_id = %s
                    """
                    cursor.execute(update_query, (
                        weight_kg, 
                        height_ft, 
                        calculated_size, 
                        datetime.now(),
                        user_id
                    ))
                    connection.commit()
                    cursor.close()
                    connection.close()
                except Error as e:
                    return jsonify({
                        'success': False,
                        'error': f'Database update failed: {str(e)}'
                    }), 500
        
        return jsonify({
            'success': True,
            'user_id': user_id,
            'weight_kg': weight_kg,
            'height_ft': height_ft,
            'calculated_size': calculated_size,
            'message': 'Size calculated and updated successfully'
        }), 200
        
    except ValueError as e:
        return jsonify({
            'success': False,
            'error': 'Invalid weight or height format'
        }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500

# ============================================================================
# API ENDPOINT 2: GET /dashboard
# ============================================================================

@app.route('/dashboard', methods=['GET'])
def get_dashboard():
    """
    Get personalized product recommendations based on purchase history.
    """
    try:
        user_id = request.args.get('user_id')

        if not user_id:
            return jsonify({
                'success': False,
                'error': 'Missing required parameter: user_id'
            }), 400

        # Check if user exists
        user = get_user_by_id(user_id)
        if not user:
            return jsonify({
                'success': False,
                'error': 'User not found'
            }), 404

        connection = get_db_connection()
        if not connection:
            return jsonify({
                'success': False,
                'error': 'Database connection failed'
            }), 500

        try:
            cursor = connection.cursor(pymysql.cursors.DictCursor)

            # Most recent purchase is used to prioritize recommendations users see first.
            last_purchase = get_last_purchase(user_id)

            purchased_pairs = []
            recommendations = []

            if last_purchase:
                # Fetch ALL distinct categories and genders the user has purchased
                cursor.execute("""
                    SELECT DISTINCT c.category, c.gender
                    FROM Purchase_History ph
                    JOIN Clothing c ON ph.product_id = c.product_id
                    WHERE ph.user_id = %s
                """, (user_id,))
                purchased_pairs = cursor.fetchall()

                # Build OR conditions for category/gender pairs
                if purchased_pairs:
                    conditions = " OR ".join(["(category = %s AND gender = %s)"] * len(purchased_pairs))
                    params = []
                    for pair in purchased_pairs:
                        params.extend([pair['category'], pair['gender']])
                    params.append(user_id)

                    query = f"""
                        SELECT product_id AS id, item_name AS name, category, gender, price, stock_quantity
                        FROM Clothing
                        WHERE ({conditions})
                        AND product_id NOT IN (
                            SELECT product_id FROM Purchase_History WHERE user_id = %s
                        )
                        ORDER BY product_id
                    """
                    cursor.execute(query, tuple(params))
                    recommendations = cursor.fetchall()

                    # Fallback to gender(s) of past purchases if no exact matches found
                    if not recommendations:
                        genders = list(set([p['gender'] for p in purchased_pairs]))
                        gender_conditions = " OR ".join(["gender = %s"] * len(genders))
                        g_params = genders + [user_id]
                        
                        cursor.execute(f"""
                            SELECT product_id AS id, item_name AS name, category, gender, price, stock_quantity
                            FROM Clothing
                            WHERE ({gender_conditions})
                            AND product_id NOT IN (
                                SELECT product_id FROM Purchase_History WHERE user_id = %s
                            )
                            ORDER BY category, product_id
                        """, tuple(g_params))
                        recommendations = cursor.fetchall()
            else:
                # If NO purchase history: Return ALL 12 items
                cursor.execute("""
                    SELECT product_id AS id, item_name AS name, category, gender, price, stock_quantity
                    FROM Clothing
                    ORDER BY product_id
                """)
                recommendations = cursor.fetchall()
            
            # Convert Decimal price to float for JSON serialisation
            for r in recommendations:
                if 'price' in r and r['price'] is not None:
                    r['price'] = float(r['price'])

            response = {
                'success': True,
                'user_id': user_id,
                'has_purchase_history': bool(last_purchase),
                'purchased_categories': [f"{p['gender']} {p['category']}" for p in purchased_pairs] if purchased_pairs else [],
                'last_purchase_item': last_purchase['item_name'] if last_purchase else None,
                'last_purchase_category': last_purchase['category'] if last_purchase else None,
                'last_purchase_gender': last_purchase['gender'] if last_purchase else None,
                'last_purchase_date': last_purchase['purchase_date'].isoformat() if last_purchase else None,
                'recommendation_count': len(recommendations),
                'recommendations': recommendations
            }

            cursor.close()
            connection.close()

            return jsonify(response), 200

        except Error as e:
            return jsonify({
                'success': False,
                'error': f'Database query failed: {str(e)}'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500

# ============================================================================
# BONUS ENDPOINTS: User Management
# ============================================================================

@app.route('/register', methods=['POST'])
def register_user():
    """
    Register a new user
    """
    try:
        data = request.get_json() or {}

        username = str(data.get('username', '')).strip()
        raw_password = str(data.get('password', ''))

        if not username or not raw_password:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: username and password are required'
            }), 400

        def to_positive_float(value, fallback):
            try:
                parsed = float(value)
                return parsed if parsed > 0 else fallback
            except (TypeError, ValueError):
                return fallback

        user_id = str(uuid.uuid4())
        password_hash = hash_password(raw_password)
        # Users table enforces weight_kg > 0 and height_ft > 0, so sanitize to valid defaults.
        weight_kg = to_positive_float(data.get('weight'), 70.0)
        height_ft = to_positive_float(data.get('height'), 5.7)
        skin_tone = str(data.get('skin_tone', 'not_specified')).strip() or 'not_specified'

        calculated_size = calculate_size(weight_kg, height_ft)
        
        connection = get_db_connection()
        if not connection:
            return jsonify({
                'success': False,
                'error': 'Database connection failed'
            }), 500
        
        try:
            cursor = connection.cursor()
            insert_query = """
                INSERT INTO Users (user_id, username, password_hash, weight_kg, height_ft, skin_tone, calculated_size)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(insert_query, (
                user_id, username, password_hash, weight_kg, height_ft, skin_tone, calculated_size
            ))
            connection.commit()
            cursor.close()
            connection.close()
            
            return jsonify({
                'success': True,
                'user': {
                    'user_id': user_id,
                    'username': username,
                    'weight_kg': weight_kg,
                    'height_ft': height_ft,
                    'skin_tone': skin_tone,
                    'calculated_size': calculated_size
                },
                'message': 'User registered successfully'
            }), 201
            
        except Error as e:
            # Handle duplicate username (MySQL error 1062)
            if e.errno == 1062:
                return jsonify({
                    'success': False,
                    'error': f"Username '{username}' already exists. Please choose another or Sign In."
                }), 409
                
            return jsonify({
                'success': False,
                'error': f'Registration failed: {str(e)}'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500

@app.route('/login', methods=['POST'])
def login_user():
    """
    Authenticate a user
    """
    try:
        data = request.get_json()
        
        if not data or 'username' not in data or 'password' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing username or password'
            }), 400
        
        username = data['username']
        password_hash = hash_password(data['password'])
        
        connection = get_db_connection()
        if not connection:
            return jsonify({
                'success': False,
                'error': 'Database connection failed'
            }), 500
        
        try:
            cursor = connection.cursor(pymysql.cursors.DictCursor)
            query = "SELECT * FROM Users WHERE username = %s AND password_hash = %s"
            cursor.execute(query, (username, password_hash))
            user = cursor.fetchone()
            cursor.close()
            connection.close()
            
            if user:
                return jsonify({
                    'success': True,
                    'user': {
                        'user_id': user['user_id'],
                        'username': user['username'],
                        'weight_kg': user['weight_kg'],
                        'height_ft': user['height_ft'],
                        'skin_tone': user['skin_tone'],
                        'calculated_size': user['calculated_size']
                    },
                    'message': 'Login successful'
                }), 200
            else:
                return jsonify({
                    'success': False,
                    'error': 'Invalid username or password'
                }), 401
                
        except Error as e:
            return jsonify({
                'success': False,
                'error': f'Login failed: {str(e)}'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Fashion Recommendation Engine',
        'timestamp': datetime.now().isoformat()
    }), 200

# ============================================================================
# AI INTEGRATION ENDPOINTS
# ============================================================================

@app.route('/explain-size', methods=['POST'])
def explain_size():
    """
    LLM-powered size explanation and color recommendations.
    """
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'weight' not in data or 'height' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: weight and height'
            }), 400
        
        weight_kg = float(data['weight'])
        height_ft = float(data['height'])
        user_id = data.get('user_id')
        skin_tone = data.get('skin_tone', 'not_specified')
        
        # Calculate size using helpers
        calculated_size = calculate_size(weight_kg, height_ft)
        weight_size = get_weight_size(weight_kg)
        height_size = get_height_size(height_ft)
        
        # Generate explanation
        if weight_size == height_size:
            explanation = (
                f"We recommend size {calculated_size} because both your weight ({weight_kg:.1f}kg) "
                f"and height ({height_ft:.2f}ft) fall within the {calculated_size} size range. "
                f"This ensures a comfortable and well-fitted garment."
            )
        else:
            explanation = (
                f"We recommend size {calculated_size} for optimal comfort. "
                f"Your weight ({weight_kg:.1f}kg) suggests size {weight_size}, "
                f"while your height ({height_ft:.2f}ft) suggests size {height_size}. "
                f"Following our 'Larger Size Rule', we recommend {calculated_size} "
                f"to ensure a comfortable fit without being too tight."
            )
        
        # Color recommendations based on skin tone
        color_guide = {
            'fair': {
                'recommended': ['Pastels', 'Light Blue', 'Soft Pink', 'Lavender', 'Mint Green'],
                'avoid': ['Neon Colors', 'Very Dark Colors'],
                'reasoning': 'Light and pastel colors complement fair skin tones beautifully.'
            },
            'light': {
                'recommended': ['Coral', 'Peach', 'Light Gray', 'Sky Blue', 'Cream'],
                'avoid': ['Overly Bright Neons'],
                'reasoning': 'Soft, warm colors enhance light skin tones.'
            },
            'medium': {
                'recommended': ['Navy', 'Olive Green', 'Burgundy', 'Teal', 'Mustard'],
                'avoid': ['Washed Out Pastels'],
                'reasoning': 'Rich, vibrant colors look stunning on medium skin tones.'
            },
            'olive': {
                'recommended': ['Earth Tones', 'Warm Browns', 'Orange', 'Gold', 'Forest Green'],
                'avoid': ['Cool Grays'],
                'reasoning': 'Warm, earthy colors complement olive undertones perfectly.'
            },
            'tan': {
                'recommended': ['Bright Colors', 'Cobalt Blue', 'Emerald', 'Hot Pink', 'White'],
                'avoid': ['Muddy Browns'],
                'reasoning': 'Bold, vibrant colors pop beautifully against tan skin.'
            },
            'dark': {
                'recommended': ['Bright White', 'Electric Blue', 'Fuchsia', 'Yellow', 'Coral'],
                'avoid': ['Very Dark Colors'],
                'reasoning': 'Bright, bold colors create beautiful contrast with dark skin tones.'
            },
            'deep': {
                'recommended': ['Jewel Tones', 'Ruby Red', 'Sapphire', 'Gold', 'Bright Orange'],
                'avoid': ['Dull Colors'],
                'reasoning': 'Rich jewel tones and metallics look spectacular on deep skin tones.'
            },
            'not_specified': {
                'recommended': ['Navy', 'White', 'Black', 'Gray', 'Denim Blue'],
                'avoid': [],
                'reasoning': 'Classic, versatile colors that work for most skin tones.'
            }
        }
        
        # Get color recommendations
        skin_tone_key = skin_tone.lower() if skin_tone else 'not_specified'
        color_recs = color_guide.get(skin_tone_key, color_guide['not_specified'])
        
        # If user_id provided, update the database with new measurements and size
        if user_id:
            connection = get_db_connection()
            if connection:
                try:
                    cursor = connection.cursor()
                    update_query = """
                        UPDATE Users 
                        SET weight_kg = %s, height_ft = %s, calculated_size = %s, updated_at = %s
                        WHERE user_id = %s
                    """
                    cursor.execute(update_query, (
                        weight_kg, 
                        height_ft, 
                        calculated_size, 
                        datetime.now(),
                        user_id
                    ))
                    connection.commit()
                    cursor.close()
                    connection.close()
                except Error as e:
                    print(f"Database update failed in explain-size: {e}")
                    # We continue even if update fails, to return the explanation
        
        response = {
            'success': True,
            'user_id': user_id,
            'calculated_size': calculated_size,
            'weight_kg': weight_kg,
            'height_ft': height_ft,
            'weight_size': weight_size,
            'height_size': height_size,
            'size_explanation': explanation,
            'color_recommendations': {
                'skin_tone': skin_tone,
                'recommended_colors': color_recs['recommended'],
                'avoid_colors': color_recs['avoid'],
                'reasoning': color_recs['reasoning']
            },
            'note': 'AI-powered personalized recommendations are powered by Groq. Ensure GROQ_API_KEY is configured in .env'
        }
        
        return jsonify(response), 200
        
    except ValueError as e:
        return jsonify({
            'success': False,
            'error': 'Invalid weight or height format'
        }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500

@app.route('/chat', methods=['POST'])
def chat_with_ai():
    """
    Interactive chatbot endpoint powered by Groq.
    """
    try:
        data = request.get_json() or {}
        user_id = data.get('user_id')
        product_id = data.get('product_id')
        user_message = data.get('message')
        history = data.get('history', [])
        current_gender = data.get('current_gender')

        if not user_message:
            return jsonify({'success': False, 'error': 'Missing message'}), 400

        # Get context: user and product info
        user_info = get_user_by_id(user_id) if user_id else {}
        product_info = {}
        all_products = []
        preferred_gender = current_gender
        
        connection = get_db_connection()
        if connection:
            cursor = connection.cursor(pymysql.cursors.DictCursor)
            if product_id:
                cursor.execute("SELECT * FROM Clothing WHERE product_id = %s", (product_id,))
                product_info = cursor.fetchone() or {}
                if product_info and product_info.get('gender'):
                    preferred_gender = product_info.get('gender')
            
            # Keep full catalog for robust fallback intent parsing.
            cursor.execute("SELECT product_id, item_name, category, gender, price FROM Clothing")
            all_products = cursor.fetchall() or []
            cursor.close()
            connection.close()

        # Build context-aware system prompt
        catalog_text = "\n".join([
            f"- {p['item_name']} ({p['gender']} {p['category']}, ${p['price']})"
            for p in all_products
        ])
        
        system_content = (
            "You are a Senior Fashion Stylist and VirtualFit AI Assistant. "
            "You can only answer clothing and fashion topics: products, fit, sizing, colors, outfit pairing, and wardrobe suggestions. "
            "If the user asks anything outside clothing/fashion, reply exactly: I can only help with clothing and styling questions. "
            "STRICT RULES: "
            "(1) Keep recommendations same-gender only (Men to Men, Women to Women). "
            "(2) If user asks what else is available, list up to 4 relevant catalog items by name. "
            "(3) If user asks for pairing advice, suggest exactly one complementary catalog item. "
            "(4) Keep response to 1-3 short sentences. "
            "(5) Do not use markdown, bullets, numbering, URLs, or image links.\n\n"
            f"Here is our current catalogue:\n{catalog_text}\n\n"
        )
        
        if user_info:
            system_content += f" The user is {user_info.get('username')} (Size {user_info.get('calculated_size')}, weight {user_info.get('weight_kg'):.1f}kg, height {user_info.get('height_ft'):.2f}ft)."
        
        if product_info:
            system_content += f" They are currently looking at the {product_info.get('item_name')} ({product_info.get('category')} for {product_info.get('gender')}, Price: ${product_info.get('price')})."
        elif preferred_gender:
            system_content += f" The user is currently shopping in {preferred_gender} products. Keep recommendations in {preferred_gender} only."

        # Prepare messages for Groq
        messages = [{"role": "system", "content": system_content}]
        
        # Add recent history only (up to last 3 exchanges) to keep latency low.
        for msg in history[-6:]:
            messages.append(msg)
            
        messages.append({"role": "user", "content": user_message})

        try:
            ai_response = call_groq(messages, max_tokens=180)
        except Exception as ai_err:
            print(f"[CHAT] Groq call failed: {ai_err}")
            fallback_response = build_chat_fallback_response(
                user_message=user_message,
                product_info=product_info,
                all_products=all_products,
                preferred_gender=preferred_gender,
                history=history,
            )
            return jsonify({
                'success': True,
                'response': fallback_response,
                'source': 'fallback'
            }), 200

        return jsonify({
            'success': True,
            'response': ai_response,
            'source': 'groq'
        }), 200

    except ValueError as e:
        return jsonify({
            'success': False,
            'error': 'Invalid weight or height format'
        }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500

@app.route('/vto-prepare', methods=['POST'])
def prepare_vto():
    """
    Prepare data for Virtual Try-On (VTO) API integration.
    """
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'user_id' not in data or 'product_id' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: user_id and product_id'
            }), 400
        
        user_id = data['user_id']
        product_id = data['product_id']
        
        # Get user information
        user = get_user_by_id(user_id)
        if not user:
            return jsonify({
                'success': False,
                'error': 'User not found'
            }), 404
        
        # Get product information
        connection = get_db_connection()
        if not connection:
            return jsonify({
                'success': False,
                'error': 'Database connection failed'
            }), 500
        
        try:
            cursor = connection.cursor(pymysql.cursors.DictCursor)
            cursor.execute(
                "SELECT * FROM Clothing WHERE product_id = %s",
                (product_id,)
            )
            product = cursor.fetchone()
            cursor.close()
            connection.close()
            
            if not product:
                return jsonify({
                    'success': False,
                    'error': 'Product not found'
                }), 404
            
            # Prepare VTO configuration
            vto_config = {
                'product_id': product['product_id'],
                'product_name': product['item_name'],
                'category': product['category'],
                'gender': product['gender'],
                'size': user.get('calculated_size', 'M'),
                'user_measurements': {
                    'weight_kg': user.get('weight_kg'),
                    'height_ft': user.get('height_ft'),
                    'calculated_size': user.get('calculated_size')
                },
                'overlay_ready': True,
                'vto_mode': 'seedream-4.5-i2i',
                'session_id': str(uuid.uuid4()),
                'timestamp': datetime.now().isoformat()
            }
            
            response = {
                'success': True,
                'user_id': user_id,
                'vto_config': vto_config,
                'note': 'Virtual Try-On is configured for ByteDance Seedream 4.5 rendering'
            }
            
            return jsonify(response), 200
            
        except Error as e:
            return jsonify({
                'success': False,
                'error': f'Database error: {str(e)}'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500

@app.route('/vton-generate', methods=['POST'])
def generate_vton():
    """
        Generate Virtual Try-On image.

        Default provider is SeedEdit (VTON_PROVIDER=seededit).
        Route is optimized to return within a bounded latency window.
    """
    import urllib.request as urllib_req
    import urllib.error
    import time

    PRODUCT_IMAGE_MAP = {
        # Keep this aligned with Frontend/constants.tsx product image paths.
        'M-UP-01': ['m1u.png'],
        'M-UP-02': ['purple-tee.png', 'm2u.png'],
        'M-UP-03': ['m3u.png'],
        'M-BT-01': ['m1L.png'],
        'M-BT-02': ['m2L.png'],
        'M-BT-03': ['m3L.png'],
        'W-UP-01': ['W1u.png'],
        'W-UP-02': ['W2u.png'],
        'W-UP-03': ['W3u.png'],
        'W-BT-01': ['w1L.png'],
        'W-BT-02': ['w2L.png'],
        'W-BT-03': ['w3L.png'],
    }

    def apply_provider_auth_headers(req, key, auth_mode='bearer'):
        mode = (auth_mode or 'bearer').strip().lower()
        if mode == 'x-api-key':
            req.add_header('x-api-key', key)
        elif mode == 'api-key':
            req.add_header('api-key', key)
        elif mode == 'token':
            req.add_header('Authorization', f'Token {key}')
        else:
            req.add_header('Authorization', f'Bearer {key}')

    def ws_post(url, payload, key, timeout_sec=30, auth_mode='bearer'):
        data = json.dumps(payload).encode('utf-8')
        req = urllib_req.Request(url, data=data, method='POST')
        apply_provider_auth_headers(req, key, auth_mode=auth_mode)
        req.add_header('Content-Type', 'application/json')
        try:
            with urllib_req.urlopen(req, timeout=timeout_sec) as r:
                return r.status, json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', errors='replace')
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {'raw': raw[:500]}
        except Exception as ex:
            return 598, {'raw': str(ex)[:500]}

    def ws_get(url, key, timeout_sec=20, auth_mode='bearer'):
        req = urllib_req.Request(url, method='GET')
        apply_provider_auth_headers(req, key, auth_mode=auth_mode)
        try:
            with urllib_req.urlopen(req, timeout=timeout_sec) as r:
                return r.status, json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', errors='replace')
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {'raw': raw[:500]}
        except Exception as ex:
            return 598, {'raw': str(ex)[:500]}

    def normalize_outputs(raw_outputs):
        if raw_outputs is None:
            return []
        if isinstance(raw_outputs, str):
            return [raw_outputs]
        if isinstance(raw_outputs, list):
            out = []
            for item in raw_outputs:
                if isinstance(item, str):
                    out.append(item)
                elif isinstance(item, dict):
                    candidate = item.get('url') or item.get('image') or item.get('output')
                    if isinstance(candidate, str):
                        out.append(candidate)
            return out
        if isinstance(raw_outputs, dict):
            for key in ('url', 'image', 'output', 'result'):
                candidate = raw_outputs.get(key)
                if isinstance(candidate, str):
                    return [candidate]
                if isinstance(candidate, list):
                    return [v for v in candidate if isinstance(v, str)]
        return []

    def extract_prediction_fields(body):
        data_block = (body.get('data', {}) or {}) if isinstance(body, dict) else {}
        status = str(data_block.get('status') or (body.get('status') if isinstance(body, dict) else '') or '').strip().lower()
        outputs = normalize_outputs(
            data_block.get('outputs')
            or data_block.get('output')
            or data_block.get('images')
            or (body.get('outputs') if isinstance(body, dict) else None)
            or (body.get('output') if isinstance(body, dict) else None)
            or (body.get('images') if isinstance(body, dict) else None)
        )
        provider_code = data_block.get('code')
        if provider_code is None and isinstance(body, dict):
            provider_code = body.get('code')
        provider_error = str(data_block.get('error') or (body.get('error') if isinstance(body, dict) else '') or '').strip()
        provider_message = str((body.get('message') if isinstance(body, dict) else '') or '').strip()
        return status, outputs, provider_code, provider_error, provider_message

    def parse_first_json_object(text):
        if not isinstance(text, str):
            return None
        start = text.find('{')
        end = text.rfind('}')
        if start < 0 or end <= start:
            return None
        try:
            return json.loads(text[start:end + 1])
        except Exception:
            return None

    def parse_validation_token(text):
        if not isinstance(text, str):
            return ''
        upper_text = text.strip().upper()
        # Prefer explicit safety tokens first and avoid matching VALID inside words like INVALID.
        match = re.search(r'\b(GENDER_MISMATCH|NO_HUMAN|UNDERAGE|VALID)\b', upper_text)
        if match:
            return match.group(1)
        return ''

    def build_seededit_prompts(selected_product_names, selected_product_ids, custom_prompt=None, target_garment_text=None):
        safe_names = [str(name).strip() for name in (selected_product_names or []) if str(name).strip()]
        target_text = str(target_garment_text or '').strip()
        garment_phrase = (
            target_text
            or (', '.join(safe_names[:3]) if safe_names else ', '.join(selected_product_ids[:3]) if selected_product_ids else 'the selected garments')
        )

        prompt = (
            f'Virtual try-on edit. Replace only the existing clothing with {garment_phrase}. '
            'Keep the same person, identity, face, hairstyle, body proportions, height, pose, background, camera angle, lighting, framing, and image crop. '
            'Copy the garment exactly from the reference image, including its color, pattern, texture, shape, fit, and placement. '
            'Do not change any other part of the person or scene.'
        )

        negative_prompt = (
            'Do not change height, body proportions, face, hairstyle, skin tone, pose, expression, background, camera angle, lighting, framing, crop, '
            'or garment color, pattern, texture, or fit. Do not add or remove people, limbs, accessories, blur, distortion, collage, split panels, or extra clothing.'
        )

        prompt_override = str(custom_prompt or '').strip()
        if prompt_override:
            prompt = f"{prompt} Additional user styling request: {prompt_override}"

        return prompt, negative_prompt

    def run_seededit_vton(
        user_image_data_uri,
        garment_images_data_uris,
        selected_product_ids,
        selected_product_names,
        selected_garment_assets,
        selected_product_categories=None,
        top_id=None,
        bottom_id=None,
        custom_prompt=None,
        target_garment_text=None,
        fallback_reason=None,
        source_width_hint=None,
        source_height_hint=None,
    ):
        seededit_key = (
            os.environ.get('ARK_API_KEY')
            or os.environ.get('SEEDEDIT_API_KEY')
            or os.environ.get('SEEDREAM_API_KEY')
            or ''
        ).strip()
        failure_prefix = f'SeedEdit fallback failed ({fallback_reason}): ' if fallback_reason else ''
        if not seededit_key:
            return jsonify({'success': False, 'error': 'VTON API key missing.'}), 502

        submit_url = (
            os.environ.get('ARK_IMAGE_GENERATIONS_ENDPOINT')
            or os.environ.get('SEEDEDIT_I2I_ENDPOINT')
            or os.environ.get('SEEDEDIT_EDIT_ENDPOINT')
            or os.environ.get('SEEDREAM_EDIT_ENDPOINT')
            or 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations'
        ).strip()

        submit_prompt, negative_prompt = build_seededit_prompts(
            selected_product_names,
            selected_product_ids,
            custom_prompt=custom_prompt,
            target_garment_text=target_garment_text,
        )
        model_name = (
            os.environ.get('SEEDEDIT_MODEL')
            or os.environ.get('ARK_SEEDEDIT_MODEL')
            or 'seedream-4-5-251128'
        ).strip()

        response_format = (os.environ.get('SEEDEDIT_RESPONSE_FORMAT') or 'url').strip().lower() or 'url'
        edit_size = (
            os.environ.get('SEEDEDIT_SIZE')
            or os.environ.get('SEEDREAM_SIZE')
            or '2048x2048'
        ).strip() or '2048x2048'

        orig_width = 0
        orig_height = 0
        try:
            source_mime, source_payload = parse_image_payload(user_image_data_uri)
            if source_payload:
                raw_source = base64.b64decode(source_payload)
                from PIL import Image
                with Image.open(io.BytesIO(raw_source)) as source_img:
                    orig_width, orig_height = source_img.size
        except Exception:
            orig_width = 0
            orig_height = 0

        if (orig_width <= 0 or orig_height <= 0) and source_width_hint and source_height_hint:
            try:
                orig_width = max(1, int(source_width_hint))
                orig_height = max(1, int(source_height_hint))
            except Exception:
                orig_width = 0
                orig_height = 0

        def data_uri_to_rgb_image(image_uri):
            _mime, payload = parse_image_payload(image_uri)
            if not payload:
                raise ValueError('Missing image payload')
            raw = base64.b64decode(payload)
            from PIL import Image
            with Image.open(io.BytesIO(raw)) as img:
                return img.convert('RGB')

        def rgb_image_to_data_uri_jpeg(image_obj, quality=92):
            out = io.BytesIO()
            image_obj.save(out, format='JPEG', quality=quality, optimize=True)
            b64 = base64.b64encode(out.getvalue()).decode('utf-8')
            return f'data:image/jpeg;base64,{b64}'

        def build_reference_board(person_data_uri, garment_data_uris):
            from PIL import Image, ImageDraw, ImageFont

            try:
                person_img = data_uri_to_rgb_image(person_data_uri)
            except Exception:
                return person_data_uri, 'person-only', {'left_ratio': 1.0, 'top_ratio': 0.0}

            garment_imgs = []
            for g_uri in garment_data_uris or []:
                try:
                    garment_imgs.append(data_uri_to_rgb_image(g_uri))
                except Exception:
                    continue

            if not garment_imgs:
                return person_data_uri, 'person-only', {'left_ratio': 1.0, 'top_ratio': 0.0}

            pw, ph = person_img.size

            # --- Garment panel: stack garments vertically in a column ---
            panel_w = max(180, int(pw * 0.38))
            divider_w = 6
            n = len(garment_imgs[:2])  # max 2 garments
            cell_h = ph // n if n > 0 else ph
            panel_h = ph

            # Cream background for garment panel (clearly different from photo)
            panel = Image.new('RGB', (panel_w, panel_h), (255, 250, 240))
            draw = ImageDraw.Draw(panel)

            for i, g_img in enumerate(garment_imgs[:2]):
                cy = i * cell_h
                # White card background for each garment
                margin = 12
                draw.rectangle([margin, cy + margin, panel_w - margin, cy + cell_h - margin],
                                fill=(255, 255, 255), outline=(200, 185, 160), width=2)
                # Fit garment inside card
                card_w = panel_w - margin * 2 - 4
                card_h = cell_h - margin * 2 - 4
                g_fit = g_img.copy()
                g_fit.thumbnail((card_w, card_h), Image.Resampling.LANCZOS)
                gx = margin + 2 + (card_w - g_fit.width) // 2
                gy = cy + margin + 2 + (card_h - g_fit.height) // 2
                panel.paste(g_fit, (gx, gy))

            # Divider strip (dark line separating person from garment reference)
            divider = Image.new('RGB', (divider_w, ph), (60, 45, 30))

            # Compose: [person | divider | garment_panel]
            total_w = pw + divider_w + panel_w
            
            import math
            padded_total_w = int(math.ceil(total_w / 64.0)) * 64
            padded_ph = int(math.ceil(ph / 64.0)) * 64

            board = Image.new('RGB', (padded_total_w, padded_ph), (245, 241, 233))
            board.paste(person_img, (0, 0))
            board.paste(divider, (pw, 0))
            board.paste(panel, (pw + divider_w, 0))

            left_ratio = pw / float(padded_total_w)
            height_ratio = ph / float(padded_ph)
            board_uri = rgb_image_to_data_uri_jpeg(board)
            return board_uri, 'side-by-side', {'left_ratio': left_ratio, 'top_ratio': 0.0, 'height_ratio': height_ratio}

        board_data_uri, board_mode, board_meta = build_reference_board(user_image_data_uri, garment_images_data_uris)

        source_width = orig_width
        source_height = orig_height
        try:
            _, b_payload = parse_image_payload(board_data_uri)
            with Image.open(io.BytesIO(base64.b64decode(b_payload))) as b_img:
                source_width, source_height = b_img.size
        except Exception:
            pass

        def resolve_generation_size(default_size):
            if source_width <= 0 or source_height <= 0:
                return default_size

            # If the source dimensions are already valid multiples of 64 within bounds, use them exactly.
            if source_width % 64 == 0 and source_height % 64 == 0 and source_width <= 2048 and source_height <= 2048 and source_width >= 768 and source_height >= 768:
                return f'{source_width}x{source_height}'

            long_side_target = 2048
            short_side_min = 1024
            min_pixels = 3686400

            scale = long_side_target / float(max(source_width, source_height))
            out_w = int(round((source_width * scale) / 64.0) * 64)
            out_h = int(round((source_height * scale) / 64.0) * 64)

            if min(out_w, out_h) < short_side_min:
                upscale = short_side_min / float(min(out_w, out_h))
                out_w = int(round((out_w * upscale) / 64.0) * 64)
                out_h = int(round((out_h * upscale) / 64.0) * 64)

            if max(out_w, out_h) > 2048:
                downscale = 2048 / float(max(out_w, out_h))
                out_w = int(round((out_w * downscale) / 64.0) * 64)
                out_h = int(round((out_h * downscale) / 64.0) * 64)

            pixel_count = out_w * out_h
            if pixel_count < min_pixels:
                if out_h >= out_w:
                    required_w = int(math.ceil((min_pixels / float(out_h)) / 64.0) * 64)
                    out_w = max(out_w, required_w)
                else:
                    required_h = int(math.ceil((min_pixels / float(out_w)) / 64.0) * 64)
                    out_h = max(out_h, required_h)

            out_w = max(768, min(2048, out_w))
            out_h = max(768, min(2048, out_h))

            if out_w * out_h < min_pixels:
                return '2048x2048'

            return f'{out_w}x{out_h}'

        resolved_edit_size = '2048x2048'

        try:
            guidance_scale = float(os.environ.get('SEEDEDIT_GUIDANCE_SCALE', '5.5'))
        except ValueError:
            guidance_scale = 5.5

        try:
            clothing_guidance_boost = float(os.environ.get('SEEDEDIT_CLOTHING_GUIDANCE_BOOST', '1.25'))
        except ValueError:
            clothing_guidance_boost = 1.25
        clothing_guidance_boost = max(1.0, min(2.0, clothing_guidance_boost))
        guidance_scale = min(12.0, guidance_scale * clothing_guidance_boost)

        watermark_raw = (os.environ.get('SEEDEDIT_WATERMARK') or 'true').strip().lower()
        watermark_enabled = watermark_raw in {'1', 'true', 'yes', 'on'}

        submit_payload = {
            'model': model_name,
            'prompt': submit_prompt,
            'negative_prompt': negative_prompt,
            'response_format': response_format,
            'size': resolved_edit_size,
            'guidance_scale': guidance_scale,
            'watermark': watermark_enabled,
        }

        id_to_garment_data_uri = {
            pid: g_uri
            for pid, g_uri in zip(selected_product_ids or [], garment_images_data_uris or [])
            if isinstance(pid, str) and isinstance(g_uri, str)
        }
        id_to_category = {
            pid: str(cat or '').strip().lower()
            for pid, cat in zip(selected_product_ids or [], selected_product_categories or [])
            if isinstance(pid, str)
        }

        resolved_top_id = str(top_id or '').strip()
        resolved_bottom_id = str(bottom_id or '').strip()
        if not resolved_top_id or not resolved_bottom_id:
            for pid in selected_product_ids or []:
                category = id_to_category.get(pid, '')
                if category == 'upper' and not resolved_top_id:
                    resolved_top_id = pid
                elif category == 'bottom' and not resolved_bottom_id:
                    resolved_bottom_id = pid

        explicit_outfit_fields_enabled = str(
            os.environ.get('SEEDEDIT_ENABLE_EXPLICIT_OUTFIT_FIELDS', 'false')
        ).strip().lower() in {'1', 'true', 'yes', 'on'}

        if explicit_outfit_fields_enabled and resolved_top_id and resolved_bottom_id:
            top_image = id_to_garment_data_uri.get(resolved_top_id, '')
            bottom_image = id_to_garment_data_uri.get(resolved_bottom_id, '')
            if top_image and bottom_image:
                submit_payload['top_image'] = top_image
                submit_payload['bottom_image'] = bottom_image
                submit_payload['category'] = 'both'
                submit_payload['task_categories'] = ['upper_body', 'lower_body']
                submit_payload['prompt'] = (
                    f"{submit_payload['prompt']} Apply both upper and lower garments in one request."
                )

        if source_width > 0 and source_height > 0:
            submit_payload['prompt'] = (
                f"{submit_payload['prompt']} Keep output canvas aspect ratio aligned to source image "
                f"({source_width}x{source_height}) and preserve full head-to-feet framing. "
                'Ensure the subject remains vertically centered with full frame height usage.'
            )

        seed_raw = (os.environ.get('SEEDEDIT_SEED') or '').strip()
        if seed_raw:
            try:
                submit_payload['seed'] = int(seed_raw)
            except ValueError:
                pass

        def extract_provider_error_info(body):
            if not isinstance(body, dict):
                return '', ''

            provider_code_value = body.get('code')
            provider_message_value = body.get('message')
            error_block = body.get('error')

            if isinstance(error_block, dict):
                if not provider_code_value:
                    provider_code_value = error_block.get('code')
                if not provider_message_value:
                    provider_message_value = error_block.get('message')
            elif isinstance(error_block, str) and not provider_message_value:
                provider_message_value = error_block

            return str(provider_code_value or '').strip(), str(provider_message_value or '').strip()

        def normalize_provider_image(image_value):
            if not isinstance(image_value, str):
                return '', 'unknown'

            raw_input = image_value.strip()
            if not raw_input:
                return '', 'unknown'

            # Keep public URLs unchanged.
            if raw_input.startswith('http://') or raw_input.startswith('https://'):
                return raw_input, 'url'

            mime = 'image/jpeg'
            # Strip Data URI prefix when frontend uploads local files.
            if raw_input.startswith('data:image') and ',' in raw_input:
                header, raw_input = raw_input.split(',', 1)
                mime_candidate = header[5:].split(';', 1)[0].strip().lower()
                if mime_candidate.startswith('image/'):
                    mime = mime_candidate

            raw_input = ''.join(raw_input.split())
            if not raw_input:
                return '', 'data-uri'

            decoded_bytes = b''
            try:
                decoded_bytes = base64.b64decode(raw_input, validate=True)
            except Exception:
                try:
                    padded = raw_input + ('=' * (-len(raw_input) % 4))
                    decoded_bytes = base64.urlsafe_b64decode(padded)
                except Exception:
                    return '', 'invalid'

            # Re-encode through Pillow to emit a clean, provider-friendly JPEG payload.
            try:
                from PIL import Image

                try:
                    provider_max_side = int(os.environ.get('SEEDEDIT_INPUT_MAX_SIDE', '1536'))
                except ValueError:
                    provider_max_side = 1536
                provider_max_side = max(768, min(2048, provider_max_side))

                provider_min_side = 768

                try:
                    provider_jpeg_quality = int(os.environ.get('SEEDEDIT_INPUT_JPEG_QUALITY', '88'))
                except ValueError:
                    provider_jpeg_quality = 88
                provider_jpeg_quality = max(70, min(95, provider_jpeg_quality))

                with Image.open(io.BytesIO(decoded_bytes)) as image:
                    image = image.convert('RGB')
                    if image.width < provider_min_side or image.height < provider_min_side:
                        padded_width = max(image.width, provider_min_side)
                        padded_height = max(image.height, provider_min_side)
                        padded = Image.new('RGB', (padded_width, padded_height), (245, 241, 233))
                        padded.paste(image, ((padded_width - image.width) // 2, (padded_height - image.height) // 2))
                        image = padded

                    if max(image.size) > provider_max_side:
                        resample = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', Image.LANCZOS)
                        scale = provider_max_side / float(max(image.size))
                        resized_width = max(provider_min_side, int(round(image.width * scale)))
                        resized_height = max(provider_min_side, int(round(image.height * scale)))
                        image = image.resize((resized_width, resized_height), resample)

                    if image.width < provider_min_side or image.height < provider_min_side:
                        padded_width = max(image.width, provider_min_side)
                        padded_height = max(image.height, provider_min_side)
                        padded = Image.new('RGB', (padded_width, padded_height), (245, 241, 233))
                        padded.paste(image, ((padded_width - image.width) // 2, (padded_height - image.height) // 2))
                        image = padded

                    output = io.BytesIO()
                    image.save(output, format='JPEG', quality=provider_jpeg_quality, optimize=True)
                    jpeg_b64 = base64.b64encode(output.getvalue()).decode('utf-8')
                return f'data:image/jpeg;base64,{jpeg_b64}', 'data-uri-jpeg'
            except Exception:
                normalized = base64.b64encode(decoded_bytes).decode('utf-8')

            # Seedream images endpoint accepts a canonical data URI for local uploads.
            return f'data:{mime};base64,{normalized}', 'data-uri'

        def normalize_output_to_source_canvas(
            image_value,
            target_w,
            target_h,
            board_left_ratio=None,
            board_top_ratio=None,
            source_image_data_uri=None,
        ):
            if target_w <= 0 or target_h <= 0 or not isinstance(image_value, str):
                return image_value

            value = image_value.strip()
            if not value:
                return image_value

            decoded_bytes = b''
            try:
                if value.startswith('data:image') and ',' in value:
                    _hdr, payload = value.split(',', 1)
                    decoded_bytes = base64.b64decode(payload)
                elif value.startswith('http://') or value.startswith('https://'):
                    req = urllib.request.Request(value, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
                    with urllib.request.urlopen(req, timeout=25) as resp:
                        decoded_bytes = resp.read()
                else:
                    return image_value
            except Exception:
                return image_value

            try:
                from PIL import Image, ImageOps, ImageChops, ImageStat

                def find_vertical_split_seam_x(rgb_img):
                    gray = rgb_img.convert('L')
                    w, h = gray.size
                    if w < 300 or h < 220:
                        return None

                    x_start = max(2, int(w * 0.20))
                    x_end = min(w - 2, int(w * 0.80))
                    if x_end <= x_start:
                        return None

                    step_y = max(2, h // 220)
                    scores = []
                    px = gray.load()
                    for x in range(x_start, x_end):
                        total = 0
                        count = 0
                        for y in range(0, h, step_y):
                            total += abs(int(px[x, y]) - int(px[x - 1, y]))
                            count += 1
                        scores.append((x, (total / count) if count else 0.0))

                    if not scores:
                        return None

                    values = sorted(v for _, v in scores)
                    median = values[len(values) // 2] if values else 0.0
                    seam_x, best_score = max(scores, key=lambda item: item[1])
                    seam_strength_ok = best_score >= max(14.0, (median * 2.2 if median > 0 else 14.0))
                    center_zone_ok = int(w * 0.25) <= seam_x <= int(w * 0.75)
                    if seam_strength_ok and center_zone_ok:
                        return seam_x
                    return None

                def find_horizontal_split_seam_y(rgb_img):
                    gray = rgb_img.convert('L')
                    w, h = gray.size
                    if w < 300 or h < 220:
                        return None

                    y_start = max(2, int(h * 0.08))
                    y_end = min(h - 2, int(h * 0.55))
                    if y_end <= y_start:
                        return None

                    step_x = max(2, w // 220)
                    scores = []
                    px = gray.load()
                    for y in range(y_start, y_end):
                        total = 0
                        count = 0
                        for x in range(0, w, step_x):
                            total += abs(int(px[x, y]) - int(px[x, y - 1]))
                            count += 1
                        scores.append((y, (total / count) if count else 0.0))

                    if not scores:
                        return None

                    values = sorted(v for _, v in scores)
                    median = values[len(values) // 2] if values else 0.0
                    seam_y, best_score = max(scores, key=lambda item: item[1])
                    seam_strength_ok = best_score >= max(14.0, (median * 2.2 if median > 0 else 14.0))
                    return seam_y if seam_strength_ok else None

                def choose_side_by_source_similarity(generated_rgb, split_x, source_rgb):
                    w, h = generated_rgb.size
                    if split_x <= 24 or split_x >= (w - 24):
                        return None

                    left_crop = generated_rgb.crop((0, 0, split_x, h))
                    right_crop = generated_rgb.crop((split_x, 0, w, h))

                    left_fit = ImageOps.fit(left_crop, (target_w, target_h), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
                    right_fit = ImageOps.fit(right_crop, (target_w, target_h), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

                    score_size = (256, 256)
                    src_small = ImageOps.fit(source_rgb, score_size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
                    left_small = ImageOps.fit(left_fit, score_size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
                    right_small = ImageOps.fit(right_fit, score_size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

                    left_diff = ImageStat.Stat(ImageChops.difference(left_small, src_small)).mean
                    right_diff = ImageStat.Stat(ImageChops.difference(right_small, src_small)).mean
                    left_score = sum(left_diff) / max(1, len(left_diff))
                    right_score = sum(right_diff) / max(1, len(right_diff))

                    return left_fit if left_score <= right_score else right_fit

                def choose_band_by_source_similarity(generated_rgb, split_y, source_rgb):
                    w, h = generated_rgb.size
                    if split_y <= 24 or split_y >= (h - 24):
                        return None

                    top_crop = generated_rgb.crop((0, 0, w, split_y))
                    bottom_crop = generated_rgb.crop((0, split_y, w, h))

                    top_fit = ImageOps.fit(top_crop, (target_w, target_h), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
                    bottom_fit = ImageOps.fit(bottom_crop, (target_w, target_h), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

                    score_size = (256, 256)
                    src_small = ImageOps.fit(source_rgb, score_size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
                    top_small = ImageOps.fit(top_fit, score_size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
                    bottom_small = ImageOps.fit(bottom_fit, score_size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

                    top_diff = ImageStat.Stat(ImageChops.difference(top_small, src_small)).mean
                    bottom_diff = ImageStat.Stat(ImageChops.difference(bottom_small, src_small)).mean
                    top_score = sum(top_diff) / max(1, len(top_diff))
                    bottom_score = sum(bottom_diff) / max(1, len(bottom_diff))

                    return top_fit if top_score <= bottom_score else bottom_fit

                with Image.open(io.BytesIO(decoded_bytes)) as generated_img:
                    generated_img = generated_img.convert('RGB')

                    enable_split_artifact_crop = str(
                        os.environ.get('VTON_ENABLE_SPLIT_ARTIFACT_CROP', 'false')
                    ).strip().lower() in {'1', 'true', 'yes', 'on'}

                    source_rgb = None
                    if isinstance(source_image_data_uri, str) and source_image_data_uri.strip():
                        try:
                            source_rgb = data_uri_to_rgb_image(source_image_data_uri)
                        except Exception:
                            source_rgb = None

                    # If we sent a side-by-side composite, ALWAYS crop the generated output
                    # to match the original person's aspect ratio and remove the garment reference panel.
                    if board_left_ratio is not None and board_left_ratio > 0.0 and generated_img.width > 0 and generated_img.height > 0:
                        left_crop_w = int(round(generated_img.width * board_left_ratio))
                        left_crop_w = max(64, min(generated_img.width, left_crop_w))
                        
                        board_height_ratio = (board_meta or {}).get('height_ratio')
                        crop_h = generated_img.height
                        if board_height_ratio is not None and board_height_ratio > 0.0:
                            crop_h = int(round(generated_img.height * board_height_ratio))
                            crop_h = max(64, min(generated_img.height, crop_h))
                            
                        generated_img = generated_img.crop((0, 0, left_crop_w, crop_h))

                    # Landscape mode fallback: remove top reference strip when still present.
                    if board_top_ratio is not None and board_top_ratio > 0.0 and generated_img.width > 0 and generated_img.height > 0:
                        crop_top = int(round(generated_img.height * board_top_ratio))
                        crop_top = max(0, min(generated_img.height - 2, crop_top))
                        if crop_top > 0:
                            generated_img = generated_img.crop((0, crop_top, generated_img.width, generated_img.height))

                    if generated_img.width == target_w and generated_img.height == target_h:
                        return rgb_image_to_data_uri_jpeg(generated_img)

                    # Preserve full composition: no crop/zoom. Contain generated output and center it on the original portrait canvas.
                    canvas_size = source_rgb.size if source_rgb is not None else (target_w, target_h)
                    contain_img = ImageOps.contain(
                        generated_img,
                        canvas_size,
                        method=Image.Resampling.LANCZOS,
                    )

                    if source_rgb is not None:
                        source_canvas = source_rgb.copy()
                    else:
                        source_canvas = Image.new('RGB', canvas_size, (245, 241, 233))

                    offset_x = (canvas_size[0] - contain_img.width) // 2
                    offset_y = (canvas_size[1] - contain_img.height) // 2
                    source_canvas.paste(contain_img, (offset_x, offset_y))
                    return rgb_image_to_data_uri_jpeg(source_canvas)
            except Exception as e:
                import traceback
                print(f"[VTON] normalize_output_to_source_canvas failed: {e}")
                traceback.print_exc()
                return image_value

        provider_image, provider_image_mode = normalize_provider_image(board_data_uri)
        if not provider_image:
            return jsonify({'success': False, 'error': 'Invalid user image payload.'}), 400

        submit_timeout_sec = 90.0
        submit_payload['image'] = provider_image
        is_explicit_full_outfit_payload = bool(submit_payload.get('top_image') and submit_payload.get('bottom_image'))
        submit_status, submit_body = ws_post(
            submit_url,
            submit_payload,
            seededit_key,
            timeout_sec=submit_timeout_sec,
            auth_mode='bearer',
        )

        provider_code, provider_message = extract_provider_error_info(submit_body)
        print(f"[VTON] Seedream submit ({board_mode}/{provider_image_mode}) HTTP {submit_status}: {str(submit_body)[:300]}")

        if is_explicit_full_outfit_payload and submit_status >= 400:
            retry_payload = dict(submit_payload)
            retry_payload.pop('top_image', None)
            retry_payload.pop('bottom_image', None)
            retry_payload.pop('category', None)
            retry_payload.pop('task_categories', None)
            retry_payload['prompt'] = (
                f"{retry_payload.get('prompt', '')} Apply both upper and lower garments in one generation."
            ).strip()
            print('[VTON] Full-outfit explicit fields rejected by provider; retrying with combined-garment prompt fallback.')
            submit_status, submit_body = ws_post(
                submit_url,
                retry_payload,
                seededit_key,
                timeout_sec=submit_timeout_sec,
                auth_mode='bearer',
            )
            provider_code, provider_message = extract_provider_error_info(submit_body)
            print(f"[VTON] Seedream fallback submit HTTP {submit_status}: {str(submit_body)[:300]}")

        provider_message_lower = provider_message.lower()

        generated_url = ''
        if isinstance(submit_body, dict):
            outputs = submit_body.get('data')
            if isinstance(outputs, list) and outputs:
                first_output = outputs[0]
                if isinstance(first_output, dict):
                    generated_url = str(first_output.get('url') or first_output.get('image_url') or '').strip()
                    if not generated_url:
                        b64_image = str(first_output.get('b64_json') or first_output.get('image_base64') or '').strip()
                        if b64_image:
                            generated_url = f'data:image/png;base64,{b64_image}'
                elif isinstance(first_output, str):
                    generated_url = first_output.strip()
            if not generated_url:
                generated_url = str(submit_body.get('url') or submit_body.get('image_url') or '').strip()

        if not generated_url:
            if submit_status == 401 or provider_code == '401' or 'unauthorized' in provider_message_lower:
                return jsonify({'success': False, 'error': f'{failure_prefix}VTON API authorization failed.'.strip()}), 502
            if 'insufficient credits' in provider_message_lower or 'top up' in provider_message_lower:
                return jsonify({'success': False, 'error': f'{failure_prefix}VTON API credits exhausted. Please top up.'.strip()}), 402
            if submit_status >= 400:
                detail = provider_message or 'VTON API request failed.'
                client_code = 400 if submit_status < 500 else 502
                return jsonify({'success': False, 'error': f'{failure_prefix}{detail}'.strip()}), client_code
            return jsonify({'success': False, 'error': f'{failure_prefix}VTON API response missing image output.'.strip()}), 502

        generated_url = normalize_output_to_source_canvas(
            generated_url,
            orig_width,
            orig_height,
            board_left_ratio=(board_meta or {}).get('left_ratio'),
            board_top_ratio=(board_meta or {}).get('top_ratio'),
            source_image_data_uri=user_image_data_uri,
        )

        print(f'[VTON] Success via Seedream-4.5: {generated_url}')
        return jsonify({
            'success': True,
            'generated_image': generated_url,
            'crop_left_ratio': (board_meta or {}).get('left_ratio'),
            'message': 'Virtual Try-On generated successfully!',
            'selected_product_id': selected_product_ids[0] if selected_product_ids else '',
            'selected_product_name': selected_product_names[0] if selected_product_names else '',
            'selected_garment_asset': selected_garment_assets[0] if selected_garment_assets else '',
            'selected_product_ids': selected_product_ids,
            'selected_product_names': selected_product_names,
            'selected_garment_assets': selected_garment_assets,
            'provider': 'bytedance-seedream-4.5',
            'provider_model': model_name,
            'fallback_from': fallback_reason or ''
        }), 200

    try:
        refresh_env()
        data = request.get_json() or {}

        def parse_positive_int(value):
            try:
                parsed = int(float(value))
                return parsed if parsed > 0 else 0
            except Exception:
                return 0

        source_width_hint = parse_positive_int(data.get('source_width'))
        source_height_hint = parse_positive_int(data.get('source_height'))

        user_image = data.get('user_image')
        custom_prompt = str(data.get('custom_prompt') or data.get('prompt') or '').strip()
        target_garment_text = str(data.get('target_garment') or '').strip()
        product_id = data.get('product_id')
        product_ids = []
        raw_product_ids = data.get('product_ids')
        if isinstance(raw_product_ids, list):
            for pid in raw_product_ids:
                if isinstance(pid, str) and pid.strip() and pid.strip() not in product_ids:
                    product_ids.append(pid.strip())
        if isinstance(product_id, str) and product_id.strip() and product_id.strip() not in product_ids:
            product_ids.insert(0, product_id.strip())

        product_id = product_ids[0] if product_ids else None
        expected_gender_from_section = data.get('expected_gender')
        vton_provider = (os.environ.get('VTON_PROVIDER') or 'seededit').strip().lower()

        if not user_image or not product_ids:
            return jsonify({'success': False, 'error': 'Missing user_image or product_id/product_ids'}), 400

        # Normalize user image. If it's a URL (e.g. from previous VTON step), fetch it and convert to base64.
        user_image_b64 = ''
        if isinstance(user_image, str) and (user_image.startswith('http://') or user_image.startswith('https://')):
            try:
                rq = urllib.request.Request(user_image, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
                with urllib.request.urlopen(rq, timeout=15) as rs:
                    img_bytes = rs.read()
                    curr_mime = rs.headers.get_content_type() or 'image/jpeg'
                    user_image_b64 = base64.b64encode(img_bytes).decode('utf-8')
                    user_image = f'data:{curr_mime};base64,{user_image_b64}'
            except Exception as fetch_err:
                print(f"[VTON] Warning: failed to fetch URL {user_image[:50]}: {fetch_err}")
                return jsonify({'success': False, 'error': 'Failed to process previous outfit step image.'}), 400
        else:
            user_image_mime, user_image_b64 = parse_image_payload(user_image)
            user_image = f'data:{user_image_mime};base64,{user_image_b64}'

        # Ensure the uploaded photo is vertical (portrait)
        try:
            from PIL import Image
            import io
            portrait_b64 = user_image_b64
            if not portrait_b64:
                _portrait_mime, portrait_b64 = parse_image_payload(user_image)

            with Image.open(io.BytesIO(base64.b64decode(portrait_b64))) as img:
                if img.width >= img.height:
                    return jsonify({'success': False, 'error': 'Please upload a vertical (portrait) full-body photo for best results.'}), 400
                if source_width_hint <= 0 or source_height_hint <= 0:
                    source_width_hint = img.width
                    source_height_hint = img.height
        except Exception:
            pass

        # --- AI IMAGE VALIDATION via Groq ---
        # Checks: 1) Human present  2) Not a baby  3) Gender matches clothing
        
        product_gender = "Unisex"
        product_category = "Upper"
        product_name = product_id
        product_names_by_id = {}
        product_categories_by_id = {}
        connection = get_db_connection()
        if connection:
            try:
                cursor = connection.cursor(pymysql.cursors.DictCursor)
                placeholders = ','.join(['%s'] * len(product_ids))
                cursor.execute(
                    f"SELECT product_id, gender, category, item_name FROM Clothing WHERE product_id IN ({placeholders})",
                    tuple(product_ids),
                )
                rows = cursor.fetchall() or []
                for row in rows:
                    row_pid = str(row.get('product_id') or '').strip()
                    if not row_pid:
                        continue
                    product_names_by_id[row_pid] = row.get('item_name') or row_pid
                    product_categories_by_id[row_pid] = str(row.get('category') or '').strip()

                primary = next((r for r in rows if str(r.get('product_id') or '').strip() == product_id), rows[0] if rows else None)
                if primary:
                    product_gender = primary.get('gender') or product_gender
                    product_category = primary.get('category') or product_category
                    product_name = primary.get('item_name') or product_name

                cursor.close()
                connection.close()
            except: pass

        ordered_product_names = [product_names_by_id.get(pid, pid) for pid in product_ids]
        ordered_product_categories = [product_categories_by_id.get(pid, '') for pid in product_ids]

        full_outfit_top_id = next(
            (pid for pid in product_ids if str(product_categories_by_id.get(pid, '')).strip().lower() == 'upper'),
            ''
        )
        full_outfit_bottom_id = next(
            (pid for pid in product_ids if str(product_categories_by_id.get(pid, '')).strip().lower() == 'bottom'),
            ''
        )
        if full_outfit_top_id and full_outfit_bottom_id:
            print(f"Processing full outfit: {full_outfit_top_id} and {full_outfit_bottom_id}")

        if expected_gender_from_section in ("Men", "Women"):
            product_gender = expected_gender_from_section

        expected_gender = "male" if product_gender == "Men" else "female" if product_gender == "Women" else "any"

        validation_enabled = str(
            os.environ.get('VTON_VALIDATION_ENABLED', 'true')
        ).strip().lower() in {'1', 'true', 'yes', 'on'}

        validation_required = str(
            os.environ.get('VTON_VALIDATION_REQUIRED', 'true')
        ).strip().lower() in {'1', 'true', 'yes', 'on'}

        try:
            validation_timeout_sec = max(2, int(float(os.environ.get('VTON_VALIDATION_TIMEOUT_SEC', '5'))))
        except ValueError:
            validation_timeout_sec = 5

        try:
            validation_max_retries = max(1, int(os.environ.get('VTON_VALIDATION_MAX_RETRIES', '1')))
        except ValueError:
            validation_max_retries = 1

        try:
            validation_image_max_side = min(1280, max(320, int(os.environ.get('VTON_VALIDATION_IMAGE_MAX_SIDE', '640'))))
        except ValueError:
            validation_image_max_side = 640

        try:
            validation_image_quality = min(90, max(45, int(os.environ.get('VTON_VALIDATION_JPEG_QUALITY', '72'))))
        except ValueError:
            validation_image_quality = 72

        validation_model = (
            os.environ.get('VTON_VALIDATION_VISION_MODEL')
            or os.environ.get('OPENROUTER_VISION_MODEL')
            or os.environ.get('OPENROUTER_MODEL')
            or ''
        ).strip() or None

        if validation_enabled:
            try:
                validation_image = compact_image_for_validation(
                    user_image,
                    max_side=validation_image_max_side,
                    jpeg_quality=validation_image_quality,
                )
                validation_mime, validation_b64 = parse_image_payload(validation_image)

                validation_prompt = (
                    "Classify this image for virtual try-on safety. "
                    f"Expected gender: {expected_gender}. "
                    "Return exactly one token only:\n"
                    "VALID\n"
                    "GENDER_MISMATCH\n"
                    "NO_HUMAN\n"
                    "UNDERAGE\n"
                    "Rules: person must be a clear adult human. "
                    "Choose GENDER_MISMATCH only when apparent gender does not match expected gender. "
                    "No JSON, no explanation."
                )

                validation_messages = [{"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{validation_mime};base64,{validation_b64}"}},
                    {"type": "text", "text": validation_prompt}
                ]}]

                ai_text = call_groq(
                    validation_messages,
                    max_tokens=8,
                    force_model=validation_model,
                    force_timeout_sec=validation_timeout_sec,
                    force_max_attempts=validation_max_retries,
                )
                token = parse_validation_token(ai_text)
                print(f"[VTON] Fast validation token={token or 'UNKNOWN'} model={validation_model or 'default'}")

                if token == 'GENDER_MISMATCH':
                    if expected_gender == 'female':
                        return jsonify({'success': False, 'error': "Upload female photo in women's section."}), 400
                    if expected_gender == 'male':
                        return jsonify({'success': False, 'error': "Upload male photo in men's section."}), 400
                    return jsonify({'success': False, 'error': 'Upload a valid photo for this section.'}), 400

                if token == 'NO_HUMAN':
                    return jsonify({'success': False, 'error': 'Upload a clear human photo.'}), 400

                if token == 'UNDERAGE':
                    return jsonify({'success': False, 'error': 'Upload an adult photo only.'}), 400

                if token == 'VALID':
                    print(f"[VTON] Fast validation PASSED for {product_gender} clothing")
                elif validation_required:
                    section_hint = "men's" if expected_gender == 'male' else "women's" if expected_gender == 'female' else 'selected'
                    print(f"[VTON] Fast validation inconclusive for {section_hint}; bypassing strict block and continuing.")
                else:
                    print('[VTON] Fast validation inconclusive; proceeding (validation not required).')

            except Exception as val_err:
                print(f"[VTON] Validation error: {val_err}")
                if validation_required:
                    print('[VTON] Validation failed in strict mode; bypassing and continuing to generation.')
                else:
                    print('[VTON] Validation failed but not required; proceeding to generation.')
        else:
            print('[VTON] Image validation skipped (VTON_VALIDATION_ENABLED=false)')

        # --- END VALIDATION ---



        # Load one or more garment images from disk as base64 data URIs.
        garment_assets = []
        garment_data_uris = []
        import base64 as b64_mod

        for pid in product_ids:
            garment_candidates = PRODUCT_IMAGE_MAP.get(pid, ['m1u.png'])
            garment_filename = None
            garment_path = None

            for candidate in garment_candidates:
                candidate_path = os.path.normpath(
                    os.path.join(os.path.dirname(__file__), '..', 'Frontend', 'public', candidate)
                )
                if os.path.exists(candidate_path):
                    garment_filename = candidate
                    garment_path = candidate_path
                    break

            if not garment_path:
                return jsonify({'success': False, 'error': f'Garment image not found for {pid}. Tried: {garment_candidates}'}), 500

            with open(garment_path, 'rb') as gf:
                garment_b64 = b64_mod.b64encode(gf.read()).decode()
            garment_data_uri = f'data:image/png;base64,{garment_b64}'
            garment_assets.append(garment_filename)
            garment_data_uris.append(garment_data_uri)

        if vton_provider in (
            'seededit',
            'seededit-3.0-i2i',
            'bytedance-seededit-3.0-i2i',
            'seedream',
            'seedream-v4.5',
            'seedream-v4.5-edit',
            'bytedance-seedream-4.5',
        ):
            return run_seededit_vton(
                user_image,
                garment_data_uris,
                product_ids,
                ordered_product_names,
                garment_assets,
                selected_product_categories=ordered_product_categories,
                top_id=full_outfit_top_id,
                bottom_id=full_outfit_bottom_id,
                custom_prompt=custom_prompt,
                target_garment_text=target_garment_text,
                source_width_hint=source_width_hint,
                source_height_hint=source_height_hint,
            )

        return jsonify({
            'success': False,
            'error': f'Unsupported VTON_PROVIDER value: {vton_provider}. Use seededit.'
        }), 500

    except Exception as e:
        print(f'[VTON] Error: {e}')
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500

# ============================================================================
# ENDPOINT: GET /products - Return all products for the frontend
# ============================================================================

@app.route('/products', methods=['GET'])
def get_products():
    """
    Return all 12 clothing products for the frontend catalogue.
    Falls back gracefully if DB is unavailable.
    """
    try:
        connection = get_db_connection()
        if not connection:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500

        cursor = connection.cursor(pymysql.cursors.DictCursor)
        cursor.execute(
            "SELECT product_id as id, item_name as name, category, gender, price, stock_quantity FROM Clothing ORDER BY gender, category, product_id"
        )
        products = cursor.fetchall()
        cursor.close()
        connection.close()

        # Convert Decimal types to float for JSON serialisation
        for p in products:
            if 'price' in p and p['price'] is not None:
                p['price'] = float(p['price'])

        return jsonify({'success': True, 'products': products, 'count': len(products)}), 200

    except Exception as e:
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500


# ============================================================================
# API ENDPOINT: POST /detect-skin-tone
# ============================================================================

# Reusable color guide (same as in /explain-size)
COLOR_GUIDE = {
    'fair': {
        'recommended': ['Pastels', 'Light Blue', 'Soft Pink', 'Lavender', 'Mint Green'],
        'avoid': ['Neon Colors', 'Very Dark Colors'],
        'reasoning': 'Light and pastel colors complement fair skin tones beautifully.'
    },
    'light': {
        'recommended': ['Coral', 'Peach', 'Light Gray', 'Sky Blue', 'Cream'],
        'avoid': ['Overly Bright Neons'],
        'reasoning': 'Soft, warm colors enhance light skin tones.'
    },
    'medium': {
        'recommended': ['Navy', 'Olive Green', 'Burgundy', 'Teal', 'Mustard'],
        'avoid': ['Washed Out Pastels'],
        'reasoning': 'Rich, vibrant colors look stunning on medium skin tones.'
    },
    'olive': {
        'recommended': ['Earth Tones', 'Warm Browns', 'Orange', 'Gold', 'Forest Green'],
        'avoid': ['Cool Grays'],
        'reasoning': 'Warm, earthy colors complement olive undertones perfectly.'
    },
    'tan': {
        'recommended': ['Bright Colors', 'Cobalt Blue', 'Emerald', 'Hot Pink', 'White'],
        'avoid': ['Muddy Browns'],
        'reasoning': 'Bold, vibrant colors pop beautifully against tan skin.'
    },
    'dark': {
        'recommended': ['Bright White', 'Electric Blue', 'Fuchsia', 'Yellow', 'Coral'],
        'avoid': ['Very Dark Colors'],
        'reasoning': 'Bright, bold colors create beautiful contrast with dark skin tones.'
    },
    'deep': {
        'recommended': ['Jewel Tones', 'Ruby Red', 'Sapphire', 'Gold', 'Bright Orange'],
        'avoid': ['Dull Colors'],
        'reasoning': 'Rich jewel tones and metallics look spectacular on deep skin tones.'
    },
    'not_specified': {
        'recommended': ['Navy', 'White', 'Black', 'Gray', 'Denim Blue'],
        'avoid': [],
        'reasoning': 'Classic, versatile colors that work for most skin tones.'
    }
}

VALID_SKIN_TONES = ['fair', 'light', 'medium', 'olive', 'tan', 'dark', 'deep']

@app.route('/detect-skin-tone', methods=['POST'])
def detect_skin_tone():
    """
    Detect skin tone from an uploaded photo using Groq vision,
    then return the detected tone and matching color recommendations.
    """
    refresh_env()

    try:
        data = request.get_json()

        if not data or 'image' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required field: image (base64-encoded)'
            }), 400

        image_value = data['image']
        user_id = data.get('user_id')

        image_mime, image_b64 = parse_image_payload(image_value)

        if not image_b64:
            return jsonify({
                'success': False,
                'error': 'Invalid image payload'
            }), 400

        # Detect skin tone using configured vision LLM (OpenRouter/Groq)
        detected_tone = 'medium'
        confidence = 'low'
        description = 'Your personalized color palette is ready!'
        
        try:
            skin_prompt = (
                "You are a professional fashion color analyst. "
                "Analyze this person's skin tone from the photo. "
                "Classify it into EXACTLY one of these categories: "
                "fair, light, medium, olive, tan, dark, deep. "
                "Respond with ONLY a JSON object in this exact format, nothing else: "
                '{"skin_tone": "<category>", "confidence": "high|medium|low", '
                '"description": "<one sentence describing the tone>"}'
            )

            messages = [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{image_b64}"}},
                {"type": "text", "text": skin_prompt}
            ]}]

            ai_response = call_groq(messages, max_tokens=150)
            print(f"[SKIN] Detection response: {ai_response}")

            json_start = ai_response.find('{')
            json_end = ai_response.rfind('}') + 1
            if json_start >= 0 and json_end > json_start:
                parsed = json.loads(ai_response[json_start:json_end])
                tone = parsed.get('skin_tone', 'medium').lower().strip()
                if tone in VALID_SKIN_TONES:
                    detected_tone = tone
                confidence = parsed.get('confidence', 'medium')
                description = parsed.get('description', 'Your personalized color palette is ready!')

        except Exception as ai_err:
            print(f"[SKIN] Detection error: {ai_err}")

        # Get color recommendations for the detected skin tone
        color_recs = COLOR_GUIDE.get(detected_tone, COLOR_GUIDE['not_specified'])


        # Optionally update the user's skin_tone in the database
        if user_id:
            connection = get_db_connection()
            if connection:
                try:
                    cursor = connection.cursor()
                    cursor.execute(
                        "UPDATE Users SET skin_tone = %s, updated_at = %s WHERE user_id = %s",
                        (detected_tone, datetime.now(), user_id)
                    )
                    connection.commit()
                    cursor.close()
                    connection.close()
                except Error as e:
                    print(f"DB update skin_tone failed: {e}")

        return jsonify({
            'success': True,
            'detected_skin_tone': detected_tone,
            'confidence': confidence,
            'description': description,
            'color_recommendations': {
                'skin_tone': detected_tone,
                'recommended_colors': color_recs['recommended'],
                'avoid_colors': color_recs['avoid'],
                'reasoning': color_recs['reasoning']
            }
        }), 200

    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500


@app.route('/checkout', methods=['POST'])
def checkout():
    """
    Record a purchase in history to drive recommendations.
    """
    try:
        data = request.json
        if not data or 'user_id' not in data or 'product_id' not in data:
            return jsonify({'success': False, 'error': 'Missing user_id or product_id'}), 400
            
        user_id = data['user_id']
        product_id = data['product_id']
        
        # Verify product exists and get price
        connection = get_db_connection()
        if not connection:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        try:
            cursor = connection.cursor(pymysql.cursors.DictCursor)
            
            # Check product
            cursor.execute("SELECT item_name, price FROM Clothing WHERE product_id = %s", (product_id,))
            product = cursor.fetchone()
            if not product:
                return jsonify({'success': False, 'error': 'Product not found'}), 404
                
            # Insert purchase
            query = """
                INSERT INTO Purchase_History (user_id, product_id, total_price, quantity)
                VALUES (%s, %s, %s, %s)
            """
            cursor.execute(query, (user_id, product_id, product['price'], 1))
            connection.commit()
            
            cursor.close()
            connection.close()
            
            return jsonify({
                'success': True,
                'message': f"Successfully purchased {product['item_name']}. Your recommendations will now be updated."
            }), 201
            
        except Error as e:
            return jsonify({'success': False, 'error': f'Checkout failed: {str(e)}'}), 500
            
    except Exception as e:
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500

if __name__ == '__main__':
    print("\n" + "=" * 80)
    print("Fashion Recommendation Engine API")
    print("=" * 80)
    print("\nAvailable Endpoints:")
    print("  POST   /calculate-size  - Calculate user size")
    print("  GET    /dashboard       - Get personalized recommendations")
    print("  POST   /checkout        - Process a purchase")
    print("  POST   /register        - Register new user")
    print("  POST   /explain-size    - LLM-powered size explanation & color recommendations")
    print("  POST   /vto-prepare     - Prepare Virtual Try-On configuration")
    print("  POST   /vton-generate   - Virtual Try-On (ByteDance SeedEdit-3.0-i2i)")
    print("  GET    /health          - Health check")
    print("\n" + "=" * 80)
    
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)