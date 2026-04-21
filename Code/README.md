# Fashion Recommendation Engine - Backend

A robust SQL-based fashion recommendation system with intelligent size calculation and personalized product recommendations.

## 🏗️ Architecture Overview

### Database Schema
- **Users Table**: Stores user credentials and physical attributes
- **Clothing Table**: Product catalog with 12 pre-loaded fashion items
- **Purchase_History Table**: Tracks user purchases for personalized recommendations

### Core Features
1. **Universal Size Calculator**: Implements the "Larger Size Rule"
2. **Smart Recommendations**: Returns products based on purchase history
3. **RESTful API**: Flask-based backend with CORS support

---

## 📊 Database Setup

### Prerequisites
- MySQL Server 8.0+
- Python 3.8+

### Step 1: Create Database
```sql
CREATE DATABASE fashion_recommendation_db;
USE fashion_recommendation_db;
```

### Step 2: Initialize Schema
```bash
mysql -u root -p fashion_recommendation_db < schema.sql
```

This will create:
- 3 tables with proper constraints and indexes
- 12 clothing items (6 Men's, 6 Women's)
- Foreign key relationships

### Verify Installation
```sql
-- Check all tables
SHOW TABLES;

-- View all products
SELECT * FROM Clothing ORDER BY gender, category;

-- Verify product count (should be 12)
SELECT COUNT(*) as total_items FROM Clothing;
```

---

## 🧮 Size Calculation Logic

### The "Larger Size Rule" (CRITICAL)

The system calculates size based on **both** weight and height:

| Size | Weight Range | Height Range |
|------|--------------|--------------|
| S    | 50-60 kg     | 4.0-5.0 ft   |
| M    | 61-75 kg     | 5.1-5.5 ft   |
| L    | 76-90 kg     | 5.6-6.0 ft   |
| XL   | 91+ kg       | 6.1+ ft      |

**Rule**: If weight and height suggest different sizes, **ALWAYS return the LARGER size**.

### Examples

```python
# Example 1: Weight dominates
Weight: 80kg → L
Height: 5.2ft → M
Result: L (larger)

# Example 2: Height dominates
Weight: 65kg → M
Height: 6.2ft → XL
Result: XL (larger)

# Example 3: Both match
Weight: 55kg → S
Height: 4.5ft → S
Result: S
```

### Test the Logic
```bash
python size_calculator.py
```

This runs 10 comprehensive test cases covering edge cases and boundaries.

---

## 🚀 API Setup

### Step 1: Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 2: Configure Database
Edit `app.py` and update the database credentials:

```python
DB_CONFIG = {
    'host': 'localhost',
    'user': 'root',
    'password': 'your_password',  # UPDATE THIS
    'database': 'fashion_recommendation_db'
}
```

### Step 3: Run the Server
```bash
python app.py
```

Server will start at: `http://localhost:5000`

---

## 📡 API Endpoints

### 1. POST `/calculate-size`
Calculate and update user's size based on measurements.

**Request:**
```json
{
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "weight": 80.5,
  "height": 5.8
}
```

**Response:**
```json
{
  "success": true,
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "weight_kg": 80.5,
  "height_ft": 5.8,
  "calculated_size": "L",
  "message": "Size calculated and updated successfully"
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:5000/calculate-size \
  -H "Content-Type: application/json" \
  -d '{"user_id": "test-user-123", "weight": 80, "height": 5.8}'
```

---

### 2. GET `/dashboard`
Get personalized product recommendations.

**Logic:**
- **No purchase history**: Returns all 12 items
- **Has purchase history**: Returns items matching the category of the last purchase

**Request:**
```
GET /dashboard?user_id=123e4567-e89b-12d3-a456-426614174000
```

**Response (No History):**
```json
{
  "success": true,
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "has_purchase_history": false,
  "recommendation_count": 12,
  "recommendations": [
    {
      "product_id": "M-UP-01",
      "item_name": "Tech-Wear Bomber",
      "category": "Upper",
      "gender": "Men",
      "price": 129.99,
      "stock_quantity": 50
    },
    ...
  ]
}
```

**Response (With History - Last purchase was "Upper"):**
```json
{
  "success": true,
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "has_purchase_history": true,
  "last_purchase_category": "Upper",
  "last_purchase_item": "Tech-Wear Bomber",
  "last_purchase_date": "2026-02-12T10:30:00",
  "recommendation_count": 6,
  "recommendations": [
    // Only Upper category items
  ]
}
```

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/dashboard?user_id=test-user-123"
```

---

### 3. POST `/register` (Bonus)
Register a new user with automatic size calculation.

**Request:**
```json
{
  "username": "john_doe",
  "password": "secure_password",
  "weight": 75.5,
  "height": 5.8,
  "skin_tone": "medium"
}
```

**Response:**
```json
{
  "success": true,
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "username": "john_doe",
  "calculated_size": "L",
  "message": "User registered successfully"
}
```

---

### 4. GET `/health`
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "Fashion Recommendation Engine",
  "timestamp": "2026-02-12T10:16:59"
}
```

---

## 🧪 Testing Workflow

### 1. Test Size Calculator
```bash
python size_calculator.py
```

Expected output: All 10 test cases should pass.

### 2. Test API Endpoints

**Register a user:**
```bash
curl -X POST http://localhost:5000/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test_user",
    "password": "test123",
    "weight": 80,
    "height": 5.8,
    "skin_tone": "medium"
  }'
```

**Get dashboard (no history):**
```bash
curl "http://localhost:5000/dashboard?user_id=<USER_ID_FROM_REGISTER>"
```

**Add a purchase manually:**
```sql
INSERT INTO Purchase_History (user_id, product_id)
VALUES ('<USER_ID>', 'M-UP-01');
```

**Get dashboard again (should show only Upper items):**
```bash
curl "http://localhost:5000/dashboard?user_id=<USER_ID>"
```

---

## 📁 Project Structure

```
DB/
├── schema.sql              # Database initialization script
├── app.py                  # Flask REST API
├── size_calculator.py      # Standalone size calculator with tests
├── requirements.txt        # Python dependencies
└── README.md              # This file
```

---

## 🔒 Security Notes

1. **Password Hashing**: Uses SHA-256 (for production, use bcrypt or Argon2)
2. **SQL Injection**: All queries use parameterized statements
3. **Input Validation**: Weight/height ranges are validated
4. **CORS**: Enabled for frontend integration

---

## 📈 Database Indexes

Optimized queries with indexes on:
- `Users.username` (unique)
- `Clothing.category`
- `Clothing.gender`
- `Clothing.(category, gender)` (composite)
- `Purchase_History.user_id`
- `Purchase_History.product_id`
- `Purchase_History.purchase_date`

---

## 🎯 Key Implementation Details

### Size Calculator Algorithm
```python
def calculate_size(weight_kg, height_ft):
    # Step 1: Calculate weight-based size
    # Step 2: Calculate height-based size
    # Step 3: Return LARGER of the two
    return max(weight_size, height_size, key=SIZE_HIERARCHY.get)
```

### Dashboard Recommendation Logic
```sql
-- If purchase history exists
SELECT * FROM Clothing 
WHERE category = (
    SELECT category FROM Purchase_History 
    WHERE user_id = ? 
    ORDER BY purchase_date DESC 
    LIMIT 1
);

-- If no purchase history
SELECT * FROM Clothing;
```

---

## 🐛 Troubleshooting

### Database Connection Error
```
Error: Can't connect to MySQL server
```
**Solution**: Verify MySQL is running and credentials are correct in `app.py`

### Import Error
```
ModuleNotFoundError: No module named 'flask'
```
**Solution**: Run `pip install -r requirements.txt`

### Size Calculation Unexpected
**Solution**: Check the test cases in `size_calculator.py` - the "larger size rule" is working as designed

---

## 📞 Support

For issues or questions:
1. Check the test cases in `size_calculator.py`
2. Verify database schema with `SHOW TABLES;`
3. Check API logs in the terminal

---

## 📝 License

This is a demonstration project for educational purposes.

---

**Built by Senior Backend Architect | 2026-02-12**
