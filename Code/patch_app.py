with open("app.py", "r", encoding="utf-8") as f:
    text = f.read()

target = "        # Normalize user image to a complete data URI while preserving original image MIME.\n        user_image_mime, user_image_b64 = parse_image_payload(user_image)\n        user_image = f'data:{user_image_mime};base64,{user_image_b64}'"

replacement = """        # Normalize user image. If it's a URL (e.g. from previous VTON step), fetch it and convert to base64.
        if isinstance(user_image, str) and (user_image.startswith('http://') or user_image.startswith('https://')):
            try:
                rq = urllib.request.Request(user_image, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
                with urllib.request.urlopen(rq, timeout=15) as rs:
                    img_bytes = rs.read()
                    curr_mime = rs.headers.get_content_type() or 'image/jpeg'
                    import base64
                    user_image = f'data:{curr_mime};base64,{base64.b64encode(img_bytes).decode("utf-8")}'
            except Exception as fetch_err:
                print(f"[VTON] Warning: failed to fetch URL {user_image[:50]}: {fetch_err}")
                return jsonify({'success': False, 'error': 'Failed to process previous outfit step image.'}), 400
        else:
            user_image_mime, user_image_b64 = parse_image_payload(user_image)
            user_image = f'data:{user_image_mime};base64,{user_image_b64}'"""

if target in text:
    text = text.replace(target, replacement)
    with open("app.py", "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print("Success")
else:
    print("Target not found.")

