import mysql.connector
import os
from dotenv import load_dotenv

load_dotenv()

# Updated configuration for Aiven Cloud Compatibility
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', ''),
    'database': os.getenv('DB_NAME', 'defaultdb'), # Use defaultdb for Aiven
    'port': int(os.getenv('DB_PORT', 26553)),      # Force Aiven Port
    'ssl_disabled': False                          # Enable SSL for Aiven
}

CLOTHING_ITEMS = [
    # Men Upper
    ('M-UP-01', 'Olive Bomber Jacket', 'Upper', 'Men', 129.99),
    ('M-UP-02', 'Graphic Tee', 'Upper', 'Men', 45.00),
    ('M-UP-03', 'Cashmere Crewneck Sweater', 'Upper', 'Men', 195.00),
    
    # Men Bottom
    ('M-BT-01', 'Khaki Chinos', 'Bottom', 'Men', 79.99),
    ('M-BT-02', 'Charcoal Dress Pants', 'Bottom', 'Men', 89.99),
    ('M-BT-03', 'Olive Cargo Pants', 'Bottom', 'Men', 69.99),
    
    # Women Upper
    ('W-UP-01', 'Silk Blouse', 'Upper', 'Women', 89.99),
    ('W-UP-02', 'Cashmere Mock Sweater', 'Upper', 'Women', 149.99),
    ('W-UP-03', 'Vintage Graphic Tee', 'Upper', 'Women', 39.99),
    
    # Women Bottom
    ('W-BT-01', 'High-Rise Wide Leg Jeans', 'Bottom', 'Women', 79.99),
    ('W-BT-02', 'Beige Linen Culottes', 'Bottom', 'Women', 95.00),
    ('W-BT-03', 'Tailored Black Trousers', 'Bottom', 'Women', 110.00),
]

def seed_data():
    try:
        print(f"Connecting to database to seed items...")
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        # Clear existing data first to avoid duplicates
        # Using TRUNCATE is cleaner if your schema allows it, otherwise DELETE works
        cursor.execute("DELETE FROM Clothing")
        conn.commit()
        
        sql = "INSERT INTO Clothing (product_id, item_name, category, gender, price, stock_quantity) VALUES (%s, %s, %s, %s, %s, %s)"
        
        count = 0
        for item in CLOTHING_ITEMS:
            stock = 100
            val = (item[0], item[1], item[2], item[3], item[4], stock)
            
            try:
                cursor.execute(sql, val)
                count += 1
            except mysql.connector.Error as err:
                print(f"⚠️ Error inserting {item[1]}: {err}")
                
        conn.commit()
        print(f"\n✅ SUCCESSFULLY INSERTED {count} CLOTHING ITEMS INTO CLOUD DATABASE!")
        
        cursor.close()
        conn.close()
        
    except mysql.connector.Error as err:
        print(f"❌ Database error: {err}")

if __name__ == "__main__":
    seed_data()