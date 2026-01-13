import json
import os
import re

def sanitize_name(name):
    """Removes characters that are illegal in file/folder names."""
    return re.sub(r'[\\/*?:"<>|]', "", name)

def organize_scryfall_data(input_file='oracle-cards.json', output_root='Scryfall_Organized'):
    if not os.path.exists(input_file):
        print(f"Error: {input_file} not found. Please ensure it is in the root directory.")
        return

    print("Reading dataset... this may take a moment.")
    with open(input_file, 'r', encoding='utf-8') as f:
        cards = json.load(f)

    for card in cards:
        # 1. Extract Colors
        # Returns list like ['W', 'U'] -> 'WU'. If empty -> 'Colorless'
        colors_list = card.get('colors', [])
        if not colors_list and 'card_faces' in card:
            colors_list = list(set(c for face in card['card_faces'] for c in face.get('colors', [])))
        
        color_folder = "".join(sorted(colors_list)) if colors_list else "Colorless"

        # 2. Extract SuperTypes
        # We look for standard MTG SuperTypes
        type_line = card.get('type_line', '')
        super_type_list = ["Basic", "Legendary", "Snow", "World", "Ongoing", "Elite"]
        found_supers = [s for s in super_type_list if s in type_line]
        super_type_folder = " ".join(found_supers) if found_supers else "Normal"

        # 3. Extract SubTypes
        # Subtypes appear after the em-dash (—)
        if " — " in type_line:
            sub_type_part = type_line.split(" — ")[1]
            # Replace spaces with underscores for cleaner folder names
            sub_type_folder = sanitize_name(sub_type_part.replace(" ", "_"))
        else:
            sub_type_folder = "No_Subtype"

        # 4. Construct Path
        # Colors > Super Type > SubType
        target_dir = os.path.join(
            output_root, 
            color_folder, 
            super_type_folder, 
            sub_type_folder
        )

        # Create the directories
        os.makedirs(target_dir, exist_ok=True)

        # 5. Save the File
        card_name = sanitize_name(card.get('name', 'Unknown_Card'))
        file_path = os.path.join(target_dir, f"{card_name}.json")

        with open(file_path, 'w', encoding='utf-8') as out_f:
            json.dump(card, out_f, indent=4)

    print(f"Success! Data organized into: {os.path.abspath(output_root)}")

if __name__ == "__main__":
    organize_scryfall_data()