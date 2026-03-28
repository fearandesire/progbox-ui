import json
import pandas as pd

YEAR = 2021
ATTRS = ["dIQ", "Dnk", "Drb", "End", "2Pt", "FT",
         "Ins", "Jmp", "oIQ", "Pss", "Reb", "Spd", "Str", "3Pt", "Hgt", "Ovr"]
FAILSAFE = {'end': 'endu', '2pt': 'fg', '3pt': 'tp', 'str': 'stre'}

def extract_metadata(export_data):
    """Extract metadata from the league export JSON."""
    meta = export_data.get("meta", {})
    game_attributes = export_data.get("gameAttributes", {})
    
    return {
        "league_name": meta.get("name", "Unknown League"),
        "season": export_data.get("season", game_attributes.get("season", "Unknown Season")),
        "phase": game_attributes.get("phase", "Unknown"),
    }

def exportcleaner(export_file, teams:list, teaminfo_file) -> tuple[pd.DataFrame, dict]:
    """
    Parse the export file and return a flat pandas.DataFrame with one row per player,
    and a metadata dictionary.
    Supports multiple teams.
    
    Columns: Team, Name, Age, PER + all ratings in ATTRS.
    """
    # Load input
    with open(export_file, "rb") as f: 
        data = json.load(f)
        players = data.get("players", [])
    
    metadata = extract_metadata(data)
    
    with open(teaminfo_file, "rb") as f: 
        team_lookup = json.load(f)

    records = []
    for p in players:
        if not p["stats"] or p["tid"] < -1: 
            continue

        stats = p["stats"][-2] if p["stats"][-1].get("playoffs") else p["stats"][-1]
        per = stats.get("per", 0)
        if per == 0:
            continue

        # Extract defensive stats for progression calculation
        dws = stats.get("dws", 0)
        ewa = stats.get("ewa", 0)

        team = team_lookup.get(str(p["tid"]))
        if teams and team not in teams: 
            continue

        age = YEAR - p["born"]["year"]
        if age < 25: 
            continue

        ratings = {k.lower(): v for k, v in p["ratings"][-1].items()}
        row = {
            "Team": team,
            "Name": f"{p['firstName']} {p['lastName']}",
            "Age": age,
            "PER": per,
            "DWS": dws,
            "EWA": ewa,
            **{a: ratings.get(FAILSAFE.get(a.lower(), a.lower()), 0) for a in ATTRS}
        }
        records.append(row)
    print("Export loaded.")
    pd.DataFrame(records).to_csv("data/input.csv")
    print("Saved to data/input.csv.")
    return pd.DataFrame(records), metadata
