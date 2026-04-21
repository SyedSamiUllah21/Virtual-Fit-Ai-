import mysql.connector
from mysql.connector import errorcode
import os
from dotenv import load_dotenv

load_dotenv()

# Pull the database name directly from the .env file
DB_NAME = os.getenv('DB_NAME', 'defaultdb')

# Updated config to include Port, Database, and SSL
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', ''),
    'port': os.getenv('DB_PORT', 26553),
    'database': DB_NAME,
    'ssl_disabled': False 
}

def init_db():
    try:
        # 1. Connect to MySQL Server (Directly to defaultdb)
        print(f"Connecting to MySQL on port {DB_CONFIG['port']}...")
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        # 2. Read & Execute Schema
        print("Executing schema.sql...")
        with open('schema.sql', 'r') as f:
            schema = f.read()
            
        # Split by ';' but allow for multi-line statements
        commands = schema.split(';')
        
        for command in commands:
            if command.strip():
                try:
                    cursor.execute(command)
                    # Consume result rows from verification queries (SHOW/SELECT)
                    if cursor.with_rows:
                        cursor.fetchall()
                except mysql.connector.Error as err:
                    print(f"⚠️ Warning executing command: {err}")
                    
        conn.commit()
        cursor.close()
        conn.close()
        print("\n✅ SUCCESS: Database initialized with all tables and products!")
        
    except mysql.connector.Error as err:
        print(f"❌ Error connecting to MySQL: {err}")
        print("👉 Please double-check your password and port in .env file")

if __name__ == "__main__":
    init_db()