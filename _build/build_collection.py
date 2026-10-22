# NOTE: superseded by server/collection.js (node server/collection.js ItMeCasey.json), which the app uses to install the collection.
# Keep both in step if you change scenes.
"""Builds ItMeCasey.json (OBS scene collection) with absolute paths for wherever this pack lives.
Run again after moving the folder:  python build_collection.py"""
import json, uuid
from pathlib import Path
from build_graphics import G

PACK = Path(__file__).resolve().parent.parent
P = PACK.as_posix()
VER = 537001986


def uid():
    return str(uuid.uuid4())


def source(name, sid, settings, versioned=None, filters=None, audio=False, muted=False, volume=1.0, mixers=0, hotkeys=None):
    s = {
        "prev_ver": VER, "name": name, "uuid": uid(), "id": sid, "versioned_id": versioned or sid,
        "settings": settings, "mixers": mixers if mixers else (255 if audio else 0), "sync": 0, "flags": 0,
        "volume": volume, "balance": 0.5, "enabled": True, "muted": muted,
        "push-to-mute": False, "push-to-mute-delay": 0, "push-to-talk": False, "push-to-talk-delay": 0,
        "hotkeys": hotkeys or {}, "deinterlace_mode": 0, "deinterlace_field_order": 0,
        "monitoring_type": 0, "private_settings": {},
    }
    if filters:
        s["filters"] = [source(n, i, st, v) for n, i, st, v in filters]
    return s


def image(name, rel):
    return source(name, "image_source", {"file": f"{P}/{rel}"})


def abgr(hexcolor):
    r, g, b = (int(hexcolor[i:i + 2], 16) for i in (1, 3, 5))
    return 0xFF000000 | b << 16 | g << 8 | r


def text(name, size, color, content=None, file=None):
    """Static text, or (file=...) a text source that reads a label file written by server/server.js."""
    st = {"font": {"face": "Bahnschrift", "size": size, "style": "Bold", "flags": 1}, "color": abgr(color),
          "opacity": 100, "antialiasing": True, "align": "left", "valign": "top", "extents": False, "outline": False}
    if file:
        st.update(read_from_file=True, file=f"{P}/data/labels/{file}.txt")
    else:
        st["text"] = content
    return source(name, "text_gdiplus", st, "text_gdiplus_v3")


def browser(name, rel, w, h, audio=False, query=""):
    return source(name, "browser_source", {
        "url": f"file:///{P}/{rel}{query}", "width": w, "height": h, "fps": 30, "fps_custom": False,
        "css": "", "shutdown": False, "restart_when_active": False, "reroute_audio": audio, "is_local_file": False,
    }, audio=audio, mixers=255 if audio else 0,
        hotkeys={"libobs.mute": [], "libobs.unmute": [], "libobs.push-to-mute": [], "libobs.push-to-talk": [], "ObsBrowser.Refresh": []})


class Scene:
    def __init__(self, name):
        self.name, self.items, self.n = name, [], 0

    def add(self, src, x=0, y=0, rect=None, visible=True, crop=True):
        """rect=(x,y,w,h) fits the source into that box (fill + crop) instead of using raw position."""
        self.n += 1
        it = {
            "name": src["name"], "source_uuid": src["uuid"], "visible": visible, "locked": False, "rot": 0.0,
            "align": 5, "bounds_type": 0, "bounds_align": 0, "bounds_crop": False,
            "crop_left": 0, "crop_top": 0, "crop_right": 0, "crop_bottom": 0, "id": self.n, "group_item_backup": False,
            "pos": {"x": float(x), "y": float(y)}, "scale": {"x": 1.0, "y": 1.0}, "bounds": {"x": 0.0, "y": 0.0},
            "scale_filter": "disable", "blend_method": "default", "blend_type": "normal",
            "show_transition": {"duration": 0}, "hide_transition": {"duration": 0}, "private_settings": {},
        }
        if rect:
            rx, ry, rw, rh = rect
            it.update(pos={"x": float(rx), "y": float(ry)}, bounds={"x": float(rw), "y": float(rh)},
                      bounds_type=3, bounds_crop=crop)
        self.items.append(it)

    def build(self):
        return {"prev_ver": VER, "name": self.name, "uuid": uid(), "id": "scene", "versioned_id": "scene",
                "settings": {"custom_size": False, "id_counter": self.n, "items": self.items},
                "mixers": 0, "sync": 0, "flags": 0, "volume": 1.0, "balance": 0.5, "enabled": True, "muted": False,
                "push-to-mute": False, "push-to-mute-delay": 0, "push-to-talk": False, "push-to-talk-delay": 0,
                "hotkeys": {}, "deinterlace_mode": 0, "deinterlace_field_order": 0, "monitoring_type": 0, "private_settings": {}}


def main():
    # ---- sources
    bg_iron = image("BG - Iron", "assets/bg_iron.png")
    bg_start = image("BG - Starting Soon", "assets/scene_starting.png")
    bg_brb = image("BG - Be Right Back", "assets/scene_brb.png")
    bg_end = image("BG - Ending", "assets/scene_ending.png")
    ov_game = image("Overlay - Gameplay", "assets/overlay_gameplay.png")
    ov_chat = image("Overlay - Just Chatting", "assets/overlay_justchatting.png")
    ov_full = image("Overlay - Full Cam", "assets/overlay_fullcam.png")
    game = source("Game Capture", "game_capture", {"capture_mode": "any_fullscreen", "priority": 1, "capture_cursor": True})
    display = source("Display Capture", "monitor_capture", {"monitor": 0, "capture_cursor": True}, "monitor_capture")
    cam = source("Webcam", "dshow_input", {})
    alerts = browser("Alerts", "overlays/alerts.html", 1920, 1080, audio=True)
    chat = browser("Chat", "overlays/chat.html", G["chat_box"][2], G["chat_box"][3])
    countdown = browser("Countdown", "overlays/countdown.html", 640, 230)
    nowplaying = browser("Now Playing", "overlays/nowplaying.html", 700, 220)
    poll = browser("Poll Overlay", "overlays/poll.html", 620, 560)
    prediction = browser("Prediction Overlay", "overlays/prediction.html", 620, 620)

    cap_f = text("Label - Latest Follower (caption)", 26, "#4FBBBC", "LATEST FOLLOWER")
    val_f = text("Label - Latest Follower", 60, "#E2DAC2", file="latest_follower")
    cap_s = text("Label - Latest Subscriber (caption)", 26, "#4FBBBC", "LATEST SUBSCRIBER")
    val_s = text("Label - Latest Subscriber", 60, "#F39120", file="latest_subscriber")

    # ---- scenes
    sc = []
    s = Scene("Starting Soon")
    s.add(bg_start); s.add(countdown, 640, 780); s.add(alerts)
    sc.append(s)

    s = Scene("Gameplay")
    s.add(bg_iron); s.add(display, rect=G["game"], visible=False); s.add(game, rect=G["game"])
    s.add(cam, rect=G["cam_game"]); s.add(ov_game); s.add(poll, 1300, 0); s.add(prediction, 1300, 0); s.add(nowplaying, 0, 790); s.add(alerts)
    sc.append(s)

    s = Scene("Just Chatting")
    s.add(bg_iron); s.add(cam, rect=G["cam_chat"]); s.add(ov_chat)
    s.add(chat, G["chat_box"][0], G["chat_box"][1]); s.add(poll, 600, 70); s.add(prediction, 600, 70); s.add(alerts)
    sc.append(s)

    s = Scene("Full Cam")
    s.add(bg_iron); s.add(cam, rect=G["cam_full"]); s.add(ov_full); s.add(poll, 1300, 0); s.add(prediction, 1300, 0); s.add(nowplaying, 0, 790); s.add(alerts)
    sc.append(s)

    s = Scene("Be Right Back")
    s.add(bg_brb)
    sc.append(s)

    s = Scene("Ending")
    s.add(bg_end)
    s.add(cap_f, 640, 715); s.add(val_f, 640, 750); s.add(cap_s, 640, 860); s.add(val_s, 640, 895)
    s.add(alerts)
    sc.append(s)

    # ---- global audio with a broadcast-style chain
    desktop = source("Desktop Audio", "wasapi_output_capture", {"device_id": "default"}, audio=True, volume=0.7,
                     filters=[("Limiter", "limiter_filter", {"threshold": -6.0, "release_time": 60}, None)])
    mic = source("Mic/Aux", "wasapi_input_capture", {"device_id": "default"}, audio=True,
                 filters=[("Noise Suppression", "noise_suppress_filter", {"method": "rnnoise"}, "noise_suppress_filter_v2"),
                          ("Noise Gate", "noise_gate_filter", {"open_threshold": -32.0, "close_threshold": -38.0}, None),
                          ("Compressor", "compressor_filter", {"ratio": 4.0, "threshold": -18.0, "attack_time": 6, "release_time": 60, "output_gain": 4.0}, None),
                          ("Limiter", "limiter_filter", {"threshold": -3.0, "release_time": 60}, None)])

    shared = [nowplaying, poll, prediction, bg_iron, bg_start, bg_brb, bg_end, cap_f, val_f, cap_s, val_s, ov_game, ov_chat, ov_full, game, display, cam, alerts, chat, countdown]
    sources = [x.build() for x in sc] + shared + [desktop, mic]
    sources.sort(key=lambda x: x["id"] == "scene")  # scenes last is fine; order doesn't matter to OBS

    out = {
        "name": "ItMeCasey",
        "DesktopAudioDevice1": desktop,
        "AuxAudioDevice1": mic,
        "sources": sources,
        "groups": [],
        "scene_order": [{"name": x.name} for x in sc],
        "current_scene": "Starting Soon",
        "current_program_scene": "Starting Soon",
        "canvases": [],
        "current_transition": "ItMeCasey Stinger",
        "transition_duration": 900,
        "transitions": [{
            "name": "ItMeCasey Stinger", "id": "obs_stinger_transition",
            "settings": {"path": f"{P}/transitions/stinger.mov", "transition_point": 900, "tp_type": 0,
                         "audio_fade_style": 1, "audio_monitoring": 0},
        }],
        "quick_transitions": [
            {"name": "Cut", "duration": 300, "hotkeys": [], "id": 1, "fade_to_black": False},
            {"name": "Fade", "duration": 300, "hotkeys": [], "id": 2, "fade_to_black": False},
            {"name": "ItMeCasey Stinger", "duration": 900, "hotkeys": [], "id": 3, "fade_to_black": False},
        ],
        "saved_projectors": [], "preview_locked": False, "scaling_enabled": False, "scaling_level": -8,
        "scaling_off_x": 0.0, "scaling_off_y": 0.0, "modules": {}, "version": 1,
    }
    (PACK / "ItMeCasey.json").write_text(json.dumps(out, indent=4), encoding="utf-8")
    print("wrote", PACK / "ItMeCasey.json")


if __name__ == "__main__":
    main()
