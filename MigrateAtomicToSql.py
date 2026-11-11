import json
import os
import sqlite3


def migrate_json_to_sql(json_path, db_path):
    if not os.path.exists(json_path):
        print(f"Error: Could not find '{json_path}' in this folder.")
        return

    # Fresh rebuild so renamed/removed AtomicCards entries do not linger.
    if os.path.exists(db_path):
        os.replace(db_path, db_path + ".bak")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("CREATE TABLE IF NOT EXISTS cards (name TEXT PRIMARY KEY)")

    cursor.execute("PRAGMA table_info(cards)")
    known_columns = {col[1] for col in cursor.fetchall()}

    print("Reading AtomicCards.json... please wait...")
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print("Processing and dynamically populating rows...")

    # MTGJSON AllPrintings-style AtomicCards wraps the map under "data".
    card_dict = data.get("data", data) if isinstance(data, dict) else {}

    for card_name, card_entry in card_dict.items():
        if isinstance(card_entry, list):
            if not card_entry:
                continue
            card_info = card_entry[0].copy()
        else:
            card_info = card_entry.copy()

        card_info["name"] = card_name

        for key in card_info.keys():
            if key not in known_columns:
                try:
                    cursor.execute(f"ALTER TABLE cards ADD COLUMN [{key}] TEXT")
                    known_columns.add(key)
                except sqlite3.OperationalError:
                    pass

        columns = list(card_info.keys())
        placeholders = ", ".join(["?"] * len(columns))
        escaped_columns = ", ".join([f"[{c}]" for c in columns])
        query = f"INSERT OR REPLACE INTO cards ({escaped_columns}) VALUES ({placeholders})"

        values = []
        for c in columns:
            val = card_info[c]
            if isinstance(val, (dict, list)):
                values.append(json.dumps(val))
            else:
                values.append(str(val) if val is not None else "")

        cursor.execute(query, values)

    conn.commit()
    conn.close()
    print(f"\nSuccess! '{db_path}' populated with {len(card_dict)} cards and {len(known_columns)} schema columns.")


if __name__ == "__main__":
    migrate_json_to_sql("AtomicCards.json", "mtg_data.db")
