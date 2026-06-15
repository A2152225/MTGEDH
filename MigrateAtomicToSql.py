import json
import sqlite3

def migrate_json_to_sql(json_path, db_path):
    # 1. Connect to local SQLite database
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 2. Create base table with just the primary key
    cursor.execute("CREATE TABLE IF NOT EXISTS cards (name TEXT PRIMARY KEY)")
    
    # Track columns we already added to avoid syntax errors
    cursor.execute("PRAGMA table_info(cards)")
    known_columns = {col[1] for col in cursor.fetchall()}

    print("Reading atomicCards.json... please wait...")
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print("Processing and dynamically altering schema...")
    
    for card_name, card_entry in data.items():
        # Handle cases where card data is wrapped in a list
        if isinstance(card_entry, list):
            if not card_entry:
                continue
            card_info = card_entry[0]
        else:
            card_info = card_entry

        # Ensure the card name is included in the dictionary keys
        card_info["name"] = card_name

        # DYNAMIC STEP: Add columns to SQL table if they don't exist yet
        for key in card_info.keys():
            if key not in known_columns:
                try:
                    cursor.execute(f"ALTER TABLE cards ADD COLUMN [{key}] TEXT")
                    known_columns.add(key)
                except sqlite3.OperationalError:
                    pass # Column was already added in this session

        # Build dynamic INSERT statement
        columns = list(card_info.keys())
        placeholders = ", ".join(["?"] * len(columns))
        escaped_columns = ", ".join([f"[{c}]" for c in columns])
        query = f"INSERT OR REPLACE INTO cards ({escaped_columns}) VALUES ({placeholders})"

        # Convert complex objects/arrays to text strings so SQL can hold them
        values = []
        for c in columns:
            val = card_info[c]
            if isinstance(val, (dict, list)):
                values.append(json.dumps(val)) # Save as JSON string
            else:
                values.append(str(val) if val is not None else "")

        cursor.execute(query, values)

    conn.commit()
    conn.close()
    print(f"Success! Created '{db_path}' with all {len(known_columns)} unique layout fields found.")

# Run the migration script locally
migrate_json_to_sql("atomicCards.json", "mtg_data.db")