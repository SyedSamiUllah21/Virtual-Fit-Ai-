/**
 * backendService.ts
 * Typed helpers that talk to the Flask backend.
 * Hardcoded to Render production URL to bypass Vercel build injection issues.
 */

// --- THE SLEDGEHAMMER FIX ---
const BASE = 'https://virtual-fit-ai.onrender.com';
// ----------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SizeResult {
    success: boolean;
    calculated_size: 'S' | 'M' | 'L' | 'XL';
    weight_kg: number;
    height_ft: number;
    size_explanation: string;
    color_recommendations: {
        skin_tone: string;
        recommended_colors: string[];
        avoid_colors: string[];
        reasoning: string;
    };
    weight_size?: string;
    height_size?: string;
    error?: string;
}

export interface User {
    user_id: string;
    username: string;
    weight_kg: number;
    height_ft: number;
    skin_tone: string;
    calculated_size: string;
}

export interface LoginResult {
    success: boolean;
    user?: User;
    message?: string;
    error?: string;
}

export interface BackendProduct {
    id: string;
    name: string;
    category: string;
    gender: string;
    price: number;
    stock_quantity?: number;
}

export interface DashboardResult {
    success: boolean;
    recommendations: BackendProduct[];
    has_purchase_history: boolean;
    last_purchase_gender?: string;
    last_purchase_category?: string;
    error?: string;
}

// ---------------------------------------------------------------------------
// login — POST /login
// ---------------------------------------------------------------------------
export async function login(username: string, password: string): Promise<LoginResult> {
    const res = await fetch(`${BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    return res.json();
}

// ---------------------------------------------------------------------------
// register — POST /register
// ---------------------------------------------------------------------------
export async function register(
    username: string,
    password: string,
    weight: number = 70,
    height: number = 5.7,
    skinTone: string = 'not_specified'
): Promise<LoginResult> {
    const res = await fetch(`${BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, weight, height, skin_tone: skinTone }),
    });
    return res.json();
}


// ---------------------------------------------------------------------------
// explainSize — POST /explain-size  (size explanation + color recommendations)
// ---------------------------------------------------------------------------
export async function explainSize(
    weight: number,
    height: number,
    skinTone: string = 'not_specified',
    userId?: string
): Promise<SizeResult> {
    const res = await fetch(`${BASE}/explain-size`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight, height, skin_tone: skinTone, user_id: userId }),
    });
    return res.json();
}


// ---------------------------------------------------------------------------
// fetchDashboard — GET /dashboard?user_id=...  (personalised recommendations)
// ---------------------------------------------------------------------------
export async function fetchDashboard(userId: string): Promise<DashboardResult> {
    const res = await fetch(`${BASE}/dashboard?user_id=${encodeURIComponent(userId)}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// checkout — POST /checkout
// ---------------------------------------------------------------------------
export async function checkout(userId: string, productId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const res = await fetch(`${BASE}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, product_id: productId }),
    });
    return res.json();
}

// ---------------------------------------------------------------------------
// chat — POST /chat
// ---------------------------------------------------------------------------
export async function chat(
    userId: string | undefined,
    productId: string | undefined,
    message: string,
    history: { role: string; content: string }[] = [],
    currentGender?: 'Men' | 'Women'
): Promise<{ success: boolean; response?: string; error?: string }> {
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const res = await fetch(`${BASE}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, product_id: productId, message, history, current_gender: currentGender }),
            });

            let data: { success: boolean; response?: string; error?: string } | null = null;
            try {
                data = (await res.json()) as { success: boolean; response?: string; error?: string };
            } catch {
                data = null;
            }

            if (res.ok && data) {
                return data;
            }

            const errorText = (data?.error || '').toLowerCase();
            const isTransient =
                res.status === 502 &&
                (errorText.includes('temporarily unavailable') || errorText.includes('try again'));

            if (isTransient && attempt < maxAttempts - 1) {
                await new Promise((resolve) => window.setTimeout(resolve, 1500 * (attempt + 1)));
                continue;
            }

            return data || { success: false, error: `Chat failed (HTTP ${res.status}).` };
        } catch (error) {
            if (attempt < maxAttempts - 1) {
                await new Promise((resolve) => window.setTimeout(resolve, 1500 * (attempt + 1)));
                continue;
            }
            throw error;
        }
    }

    return { success: false, error: 'AI chat is temporarily unavailable. Please try again in a moment.' };
}

// ---------------------------------------------------------------------------
// detectSkinTone — POST /detect-skin-tone  (AI photo analysis)
// ---------------------------------------------------------------------------
export interface SkinToneResult {
    success: boolean;
    detected_skin_tone: string;
    confidence: string;
    description: string;
    color_recommendations: {
        skin_tone: string;
        recommended_colors: string[];
        avoid_colors: string[];
        reasoning: string;
    };
    error?: string;
}

export async function detectSkinTone(imageData: string, userId?: string): Promise<SkinToneResult> {
    const res = await fetch(`${BASE}/detect-skin-tone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, user_id: userId }),
    });
    return res.json();
}

// ---------------------------------------------------------------------------
// generateVTON — POST /vton-generate  (multi-provider backend VTON)
// ---------------------------------------------------------------------------
export interface VTONResult {
    success: boolean;
    generated_image?: string;
    crop_left_ratio?: number;
    message?: string;
    note?: string;
    error?: string;
}

export async function generateVTON(
    imageBase64: string,
    productId: string,
    userId?: string,
    expectedGender?: 'Men' | 'Women',
    productIds?: string[],
    customPrompt?: string,
    targetGarment?: string,
    sourceWidth?: number,
    sourceHeight?: number
): Promise<VTONResult> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 600000);

    try {
        const res = await fetch(`${BASE}/vton-generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_image: imageBase64,
                product_id: productId,
                product_ids: productIds && productIds.length > 0 ? productIds : undefined,
                user_id: userId,
                expected_gender: expectedGender,
                custom_prompt: customPrompt && customPrompt.trim().length > 0 ? customPrompt.trim() : undefined,
                target_garment: targetGarment && targetGarment.trim().length > 0 ? targetGarment.trim() : undefined,
                source_width: Number.isFinite(sourceWidth) ? Math.round(sourceWidth as number) : undefined,
                source_height: Number.isFinite(sourceHeight) ? Math.round(sourceHeight as number) : undefined,
            }),
            signal: controller.signal,
        });

        let data: VTONResult | null = null;
        try {
            data = (await res.json()) as VTONResult;
        } catch {
            data = null;
        }

        if (!res.ok) {
            return {
                success: false,
                error: data?.error || `Virtual try-on failed (HTTP ${res.status}).`,
            };
        }

        return data || { success: false, error: 'Virtual try-on returned an empty response.' };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return {
                success: false,
                error: 'Virtual try-on is taking too long. Please try again with a clearer, smaller photo.',
            };
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}