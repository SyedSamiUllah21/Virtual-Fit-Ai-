-- ============================================================================
-- Fashion Recommendation Engine - Database Schema
-- ============================================================================
-- Author: Senior Backend Architect
-- Date: 2026-02-12
-- Description: Complete database initialization script with tables and seed data
-- ============================================================================

-- Drop existing tables if they exist (for clean setup)
DROP TABLE IF EXISTS Purchase_History;
DROP TABLE IF EXISTS Clothing;
DROP TABLE IF EXISTS Users;

-- ============================================================================
-- TABLE 1: Users
-- ============================================================================
-- Stores user authentication and physical attributes for size calculation
CREATE TABLE Users (
    user_id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    weight_kg FLOAT NOT NULL CHECK (weight_kg > 0),
    height_ft FLOAT NOT NULL CHECK (height_ft > 0),
    skin_tone VARCHAR(50),
    calculated_size VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username)
);

-- ============================================================================
-- TABLE 2: Clothing (Product Catalog)
-- ============================================================================
-- Stores the fashion product inventory
CREATE TABLE Clothing (
    product_id VARCHAR(20) PRIMARY KEY,
    item_name VARCHAR(200) NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN ('Upper', 'Bottom')),
    gender VARCHAR(10) NOT NULL CHECK (gender IN ('Men', 'Women')),
    price DECIMAL(10, 2) DEFAULT 0.00,
    stock_quantity INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_gender (gender),
    INDEX idx_category_gender (category, gender)
);

-- ============================================================================
-- TABLE 3: Purchase_History
-- ============================================================================
-- Tracks user purchase history for personalized recommendations
CREATE TABLE Purchase_History (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    product_id VARCHAR(20) NOT NULL,
    purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    quantity INT DEFAULT 1,
    total_price DECIMAL(10, 2),
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES Clothing(product_id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_product_id (product_id),
    INDEX idx_purchase_date (purchase_date)
);

-- ============================================================================
-- SEED DATA: Clothing Catalog (12 Items)
-- ============================================================================

-- Men's Upper Wear
INSERT INTO Clothing (product_id, item_name, category, gender, price, stock_quantity) VALUES
('M-UP-01', 'Tech-Wear Bomber', 'Upper', 'Men', 129.99, 50),
('M-UP-02', 'White Oxford', 'Upper', 'Men', 79.99, 75),
('M-UP-03', 'Navy Flannel', 'Upper', 'Men', 89.99, 60);

-- Men's Bottom Wear
INSERT INTO Clothing (product_id, item_name, category, gender, price, stock_quantity) VALUES
('M-BT-01', 'Khaki Chinos', 'Bottom', 'Men', 69.99, 80),
('M-BT-02', 'Grey Slacks', 'Bottom', 'Men', 99.99, 45),
('M-BT-03', 'Cargo Trousers', 'Bottom', 'Men', 79.99, 55);

-- Women's Upper Wear
INSERT INTO Clothing (product_id, item_name, category, gender, price, stock_quantity) VALUES
('W-UP-01', 'Silk Blouse', 'Upper', 'Women', 119.99, 40),
('W-UP-02', 'Mock-Neck Sweater', 'Upper', 'Women', 89.99, 65),
('W-UP-03', 'Graphic Tee', 'Upper', 'Women', 39.99, 100);

-- Women's Bottom Wear
INSERT INTO Clothing (product_id, item_name, category, gender, price, stock_quantity) VALUES
('W-BT-01', 'Mom Jeans', 'Bottom', 'Women', 89.99, 70),
('W-BT-02', 'Linen Culottes', 'Bottom', 'Women', 79.99, 50),
('W-BT-03', 'Ankle Pants', 'Bottom', 'Women', 69.99, 60);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify all tables are created
SHOW TABLES;

-- Verify clothing catalog
SELECT 
    gender,
    category,
    COUNT(*) as item_count
FROM Clothing
GROUP BY gender, category
ORDER BY gender, category;

-- Display all products
SELECT * FROM Clothing ORDER BY gender, category, product_id;

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
