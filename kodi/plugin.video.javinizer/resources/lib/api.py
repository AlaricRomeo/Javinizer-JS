"""HTTP client for the Javinizer-js Kodi API (/kodi/*), with password/token login."""
import json
import urllib.error
import urllib.request
from urllib.parse import urlencode

import xbmc
import xbmcaddon
import xbmcgui

ADDON = xbmcaddon.Addon()
TOKEN_PROPERTY = "javinizer.token"
TIMEOUT = 60


class ApiError(Exception):
    def __init__(self, status, message, payload=None):
        super().__init__(message)
        self.status = status
        self.payload = payload or {}


class LoginCancelled(Exception):
    pass


def tr(string_id):
    return ADDON.getLocalizedString(string_id)


_server_url = None  # per-run cache: image_url() needs it for every listed image


def server_url():
    global _server_url
    if _server_url is None:
        # Fresh instance: the value may have just been changed in the settings dialog
        url = xbmcaddon.Addon().getSetting("server_url").strip().rstrip("/")
        if url and "://" not in url:
            url = "http://" + url
        _server_url = url
    return _server_url


def open_settings():
    global _server_url
    ADDON.openSettings()
    _server_url = None


def ensure_server_url():
    """First run / unreachable server: explain and open the settings.
    Returns True when a server URL is set afterwards."""
    if server_url():
        return True
    xbmcgui.Dialog().ok(addon_name(), tr(30043))
    open_settings()
    return bool(server_url())


def offer_settings(err):
    """Server unreachable: offer to fix the address instead of looping."""
    if xbmcgui.Dialog().yesno(addon_name(), tr(30044).format(server_url() or "-", err)):
        open_settings()


# ── Token storage ─────────────────────────────
# "Remember login" on: token kept in the add-on settings (never the password).
# Off: token kept only in a window property, gone when Kodi restarts.

def _remember():
    return ADDON.getSettingBool("remember_login")


_token = None  # per-run cache: image_url() needs it for every listed image


def get_token():
    global _token
    if _token is None:
        if _remember():
            _token = ADDON.getSetting("token")
        else:
            if ADDON.getSetting("token"):
                ADDON.setSetting("token", "")
            _token = xbmcgui.Window(10000).getProperty(TOKEN_PROPERTY)
    return _token


def set_token(token):
    global _token
    _token = token
    if _remember():
        ADDON.setSetting("token", token)
    else:
        xbmcgui.Window(10000).setProperty(TOKEN_PROPERTY, token)


def clear_token():
    global _token
    _token = ""
    ADDON.setSetting("token", "")
    xbmcgui.Window(10000).clearProperty(TOKEN_PROPERTY)


# ── HTTP ─────────────────────────────

def addon_name():
    return ADDON.getAddonInfo("name")


def _request(method, path, params=None, body=None, token=None, raw=False):
    url = server_url() + path
    if params:
        url += "?" + urlencode(params)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            content = resp.read()
            return content if raw else json.loads(content.decode("utf-8"))
    except urllib.error.HTTPError as err:
        try:
            payload = json.loads(err.read().decode("utf-8"))
        except Exception:
            payload = {}
        raise ApiError(err.code, payload.get("error") or str(err), payload)
    except urllib.error.URLError as err:
        raise ApiError(0, str(err.reason))


def login():
    """Ask the password until it is accepted; raises LoginCancelled on cancel."""
    if not ensure_server_url():
        raise LoginCancelled()
    # Reachability first: no point asking the password of a server that isn't there
    try:
        _request("GET", "/kodi/addon")
    except ApiError as err:
        if err.status != 401:
            raise
    while True:
        password = xbmcgui.Dialog().input(tr(30030), option=xbmcgui.ALPHANUM_HIDE_INPUT)
        if not password:
            raise LoginCancelled()
        try:
            result = _request("POST", "/kodi/login", body={"password": password, "device": xbmc.getInfoLabel("System.FriendlyName")})
        except ApiError as err:
            if err.status == 401:
                xbmcgui.Dialog().notification(addon_name(), tr(30031), xbmcgui.NOTIFICATION_ERROR)
                continue
            raise
        set_token(result["token"])
        return result["token"]


def get(path, params=None, raw=False):
    token = get_token() or login()
    try:
        return _request("GET", path, params=params, token=token, raw=raw)
    except ApiError as err:
        if err.status != 401:
            raise
        clear_token()
        return _request("GET", path, params=params, token=login(), raw=raw)


def post_quiet(path, body):
    """POST with the stored token only: never prompts (background service)."""
    global _token
    _token = None  # the service runs for hours: re-read the stored token
    token = get_token()
    if not token:
        return None
    try:
        return _request("POST", path, body=body, token=token)
    except ApiError as err:
        xbmc.log("[Javinizer-JS] {} failed: {}".format(path, err), xbmc.LOGWARNING)
        return None


def logout():
    token = get_token()
    if token:
        try:
            _request("POST", "/kodi/logout", token=token)
        except ApiError:
            pass
    clear_token()


def image_url(path):
    """Absolute URL for an image path returned by the API (token in the query)."""
    if not path:
        return ""
    if path.startswith("http://") or path.startswith("https://"):
        return path
    sep = "&" if "?" in path else "?"
    return server_url() + path + sep + "t=" + get_token()
