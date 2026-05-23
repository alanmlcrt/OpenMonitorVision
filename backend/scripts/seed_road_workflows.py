"""
Seed — Workflows de surveillance d'une route (flux YouTube live)
================================================================
Exécuter depuis le dossier backend/ :
    python scripts/seed_road_workflows.py

Crée 5 workflows du plus simple au plus complexe.
Configurez ensuite la source_id dans chaque workflow via le builder.

Hypothèse de frame : 1280 × 720 px (standard YouTube 720p).
"""
from __future__ import annotations

import asyncio
import json
import sys
import os

# Rendre les imports app disponibles sans install
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.db.database import AsyncSessionLocal, engine
from app.db.models import Workflow, Base


# ─── Helpers layout ──────────────────────────────────────────────────────────

def _node(nid: str, ntype: str, label: str, x: int, y: int, config: dict) -> dict:
    return {
        "id": nid,
        "type": ntype,
        "position": {"x": x, "y": y},
        "data": {"type": ntype, "label": label, "config": config},
    }


def _edge(src: str, tgt: str) -> dict:
    return {"id": f"e-{src}-{tgt}", "source": src, "target": tgt}


def _chain(*node_ids: str) -> list[dict]:
    return [_edge(node_ids[i], node_ids[i + 1]) for i in range(len(node_ids) - 1)]


# ─── Coordonnées réutilisables (frame 1280×720) ──────────────────────────────

# Zone chaussée (centre du cadre, zone de circulation)
ROAD_ZONE = {
    "name": "Chaussée",
    "points": [[80, 280], [1200, 280], [1200, 660], [80, 660]],
}

# Zone d'entrée gauche
ENTRY_ZONE = {
    "name": "Entrée",
    "points": [[0, 280], [280, 280], [280, 660], [0, 660]],
}

# Zone de sortie droite
EXIT_ZONE = {
    "name": "Sortie",
    "points": [[1000, 280], [1280, 280], [1280, 660], [1000, 660]],
}

# Ligne de comptage verticale au centre
COUNT_LINE = {"start_x": 640, "start_y": 200, "end_x": 640, "end_y": 680}

# Source placeholder (l'utilisateur ajuste source_id dans le builder)
SOURCE_ID = 1

# ─── Workflow 1 — Observation basique ────────────────────────────────────────
# Source → YOLO Detect → Overlay
# But : voir ce que YOLO détecte sur la route, sans filtrage ni enregistrement.

def wf1() -> dict:
    GAP = 300
    nodes = [
        _node("n1", "source",      "Source YouTube",   100, 300, {"source_id": SOURCE_ID}),
        _node("n2", "yolo_detect", "YOLO Detect",       100 + GAP, 300, {
            "model_path": "yolov8n.pt",
            "confidence": 0.25,
            "iou": 0.7,
            "device": "auto",
        }),
        _node("n3", "overlay",     "Overlay",           100 + GAP * 2, 300, {
            "show_labels": True,
            "show_confidence": True,
            "show_zones": False,
        }),
    ]
    return {"nodes": nodes, "edges": _chain("n1", "n2", "n3")}


# ─── Workflow 2 — Comptage de véhicules ──────────────────────────────────────
# Source → YOLO → ConfFilter → ClassFilter → Tracker → EventTrigger → SaveEvent → Overlay
# But : compter chaque véhicule unique qui apparaît, avec cooldown.

def wf2() -> dict:
    GAP = 260
    x = 60
    nodes = [
        _node("n1", "source",           "Source YouTube",      x, 300, {"source_id": SOURCE_ID}),
        _node("n2", "yolo_detect",      "YOLO Detect",         x + GAP,   300, {
            "model_path": "yolov8n.pt", "confidence": 0.25, "iou": 0.7, "device": "auto",
        }),
        _node("n3", "confidence_filter","Confiance ≥ 0.45",    x + GAP*2, 300, {"min_confidence": 0.45}),
        _node("n4", "class_filter",     "Véhicules",           x + GAP*3, 300, {
            "classes": ["car", "truck", "bus", "motorcycle"],
        }),
        _node("n5", "tracker",          "Tracker ByteTrack",   x + GAP*4, 300, {"enabled": True}),
        _node("n6", "event_trigger",    "Déclencheur",         x + GAP*5, 300, {
            "cooldown_seconds": 10,
            "trigger_once_per_object": True,
        }),
        _node("n7", "save_event",       "Sauvegarder",         x + GAP*6, 300, {"save_frame": True}),
        _node("n8", "overlay",          "Overlay",             x + GAP*7, 300, {
            "show_labels": True, "show_confidence": True, "show_tracker_id": True,
        }),
    ]
    return {"nodes": nodes, "edges": _chain("n1","n2","n3","n4","n5","n6","n7","n8")}


# ─── Workflow 3 — Alerte piéton sur chaussée ─────────────────────────────────
# Source → YOLO → ConfFilter → ClassFilter(piéton/vélo) → Tracker → ZoneFilter →
#          EventTrigger → SaveEvent → Overlay
# But : déclencher une alerte dès qu'un piéton ou un cycliste entre sur la chaussée.

def wf3() -> dict:
    GAP = 260
    x = 60
    nodes = [
        _node("n1", "source",           "Source YouTube",       x, 300, {"source_id": SOURCE_ID}),
        _node("n2", "yolo_detect",      "YOLO Detect",          x + GAP,   300, {
            "model_path": "yolov8n.pt", "confidence": 0.25, "iou": 0.7, "device": "auto",
        }),
        _node("n3", "confidence_filter","Confiance ≥ 0.45",     x + GAP*2, 300, {"min_confidence": 0.45}),
        _node("n4", "class_filter",     "Piétons & Vélos",      x + GAP*3, 300, {
            "classes": ["person", "bicycle"],
        }),
        _node("n5", "tracker",          "Tracker ByteTrack",    x + GAP*4, 300, {"enabled": True}),
        _node("n6", "zone_filter",      "Zone Chaussée",        x + GAP*5, 300, {
            "zones": [ROAD_ZONE],
        }),
        _node("n7", "event_trigger",    "Alerte Piéton",        x + GAP*6, 300, {
            "cooldown_seconds": 5,
            "trigger_once_per_object": True,
        }),
        _node("n8", "save_event",       "Sauvegarder",          x + GAP*7, 300, {"save_frame": True}),
        _node("n9", "overlay",          "Overlay",              x + GAP*8, 300, {
            "show_labels": True, "show_confidence": True, "show_zones": True,
        }),
    ]
    return {"nodes": nodes, "edges": _chain("n1","n2","n3","n4","n5","n6","n7","n8","n9")}


# ─── Workflow 4 — Comptage directionnel par franchissement de ligne ───────────
# Source → YOLO → ConfFilter → ClassFilter(véhicules) → Tracker →
#          LineCrossing → SaveEvent → Overlay
# But : compter les véhicules qui franchissent la ligne et leur direction
#       (entrant / sortant du champ).

def wf4() -> dict:
    GAP = 260
    x = 60
    nodes = [
        _node("n1", "source",           "Source YouTube",       x, 300, {"source_id": SOURCE_ID}),
        _node("n2", "yolo_detect",      "YOLO Detect",          x + GAP,   300, {
            "model_path": "yolov8n.pt", "confidence": 0.25, "iou": 0.7, "device": "auto",
        }),
        _node("n3", "confidence_filter","Confiance ≥ 0.40",     x + GAP*2, 300, {"min_confidence": 0.40}),
        _node("n4", "class_filter",     "Véhicules",            x + GAP*3, 300, {
            "classes": ["car", "truck", "bus", "motorcycle"],
        }),
        _node("n5", "tracker",          "Tracker ByteTrack",    x + GAP*4, 300, {"enabled": True}),
        _node("n6", "line_crossing",    "Ligne de comptage",    x + GAP*5, 300, {
            "line": COUNT_LINE,
            "direction": "both",
            "anchor": "bottom_center",
        }),
        _node("n7", "save_event",       "Sauvegarder franchiss.", x + GAP*6, 300, {"save_frame": True}),
        _node("n8", "overlay",          "Overlay + Compteur",   x + GAP*7, 300, {
            "show_labels": True, "show_tracker_id": True, "show_line_counter": True,
        }),
    ]
    return {"nodes": nodes, "edges": _chain("n1","n2","n3","n4","n5","n6","n7","n8")}


# ─── Workflow 5 — Surveillance complète avec alertes ─────────────────────────
# Source → YOLO → ConfFilter → ClassFilter(tout) → ColorFilter →
#          Tracker → ZoneSequenceTrigger(Entrée→Sortie) →
#          CropSave → SaveEvent → Notify(webhook) → Overlay
# But : suivre chaque véhicule depuis la zone d'entrée jusqu'à la zone de sortie,
#       sauvegarder un crop de chaque passage, et envoyer une alerte webhook.

def wf5() -> dict:
    GAP = 240
    x = 40
    nodes = [
        _node("n1",  "source",                "Source YouTube",         x, 300, {"source_id": SOURCE_ID}),
        _node("n2",  "yolo_detect",           "YOLO Detect",            x + GAP,    300, {
            "model_path": "yolov8n.pt", "confidence": 0.25, "iou": 0.7, "device": "auto",
        }),
        _node("n3",  "confidence_filter",     "Confiance ≥ 0.40",       x + GAP*2,  300, {"min_confidence": 0.40}),
        _node("n4",  "class_filter",          "Tous véhicules + piétons",x + GAP*3,  300, {
            "classes": ["car", "truck", "bus", "motorcycle", "bicycle", "person"],
        }),
        _node("n5",  "color_filter",          "Couleur véhicule",        x + GAP*4,  300, {
            "colors": ["white", "black", "red", "blue", "silver"],
            "min_ratio": 0.10,
        }),
        _node("n6",  "tracker",               "Tracker ByteTrack",       x + GAP*5,  300, {"enabled": True}),
        _node("n7",  "zone_sequence_trigger", "Séquence Entrée→Sortie",  x + GAP*6,  300, {
            "zones": [ENTRY_ZONE, EXIT_ZONE],
            "sequence": ["Entrée", "Sortie"],
            "max_seconds_between_zones": 30,
            "anchor": "bottom_center",
        }),
        _node("n8",  "crop_save",             "Sauvegarder crop",        x + GAP*7,  300, {
            "padding": 20,
            "save_annotated": True,
        }),
        _node("n9",  "save_event",            "Sauvegarder événement",   x + GAP*8,  300, {"save_frame": True}),
        _node("n10", "notify",                "Notification Webhook",    x + GAP*9,  300, {
            "channel": "webhook",
            "webhook_url": "https://your-webhook-url/alert",
            "webhook_method": "POST",
        }),
        _node("n11", "overlay",               "Overlay complet",         x + GAP*10, 300, {
            "show_labels": True,
            "show_confidence": True,
            "show_tracker_id": True,
            "show_zones": True,
        }),
    ]
    # Branche principale : n1 → n2 → ... → n9 → n10
    # Overlay se branche sur la fin de la chaîne (n9)
    edges = _chain("n1","n2","n3","n4","n5","n6","n7","n8","n9","n10")
    # L'overlay lit le contexte partagé — on le connecte après le tracker
    # pour avoir les overlays même si la séquence n'est pas complétée
    edges += [_edge("n6", "n11")]
    return {"nodes": nodes, "edges": edges}


# ─── Données des 5 workflows ─────────────────────────────────────────────────

WORKFLOWS = [
    {
        "name": "Route — 1. Observation basique",
        "enabled": False,
        **wf1(),
    },
    {
        "name": "Route — 2. Comptage de véhicules",
        "enabled": False,
        **wf2(),
    },
    {
        "name": "Route — 3. Alerte piéton sur chaussée",
        "enabled": False,
        **wf3(),
    },
    {
        "name": "Route — 4. Comptage directionnel (franchissement)",
        "enabled": False,
        **wf4(),
    },
    {
        "name": "Route — 5. Surveillance complète avec alertes",
        "enabled": False,
        **wf5(),
    },
]


# ─── Seed ─────────────────────────────────────────────────────────────────────

async def seed() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        created = 0
        for wf_data in WORKFLOWS:
            wf = Workflow(
                name=wf_data["name"],
                nodes=wf_data["nodes"],
                edges=wf_data["edges"],
                enabled=wf_data["enabled"],
            )
            db.add(wf)
            created += 1
        await db.commit()
        print(f"[OK] {created} workflows crees.")
        print()
        print("  Pensez a :")
        print("  1. Ajouter une source 'stream' pointant vers le flux YouTube (via yt-dlp ou m3u8).")
        print("  2. Mettre a jour source_id dans chaque workflow (Builder > node Source).")
        print("  3. Ajuster les zones et la ligne de comptage selon le cadre reel.")
        print("  4. Configurer l'URL webhook dans le workflow 5.")


if __name__ == "__main__":
    asyncio.run(seed())
