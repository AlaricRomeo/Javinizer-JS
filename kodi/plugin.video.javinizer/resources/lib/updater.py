"""Self-update from the Javinizer-JS server: the server ships the add-on zip
(GET /kodi/addon.zip), so a newer version is offered when the root menu opens."""
import io
import zipfile

import xbmc
import xbmcgui
import xbmcvfs

from resources.lib import api
from resources.lib.api import ADDON, ApiError, LoginCancelled, tr

CHECKED_PROPERTY = "javinizer.update_checked"


def _version(text):
    return tuple(int(p) if p.isdigit() else 0 for p in str(text).split("."))


def _install(data):
    addon_id = ADDON.getAddonInfo("id")
    archive = zipfile.ZipFile(io.BytesIO(data))
    for name in archive.namelist():
        # Only this add-on's own folder, no path escapes
        if not name.startswith(addon_id + "/") or ".." in name.split("/"):
            raise ValueError("unexpected entry " + name)
    archive.extractall(xbmcvfs.translatePath("special://home/addons/"))
    xbmc.executebuiltin("UpdateLocalAddons")


def check_once():
    """Asks at most once per Kodi session; never breaks the menu on errors."""
    window = xbmcgui.Window(10000)
    if window.getProperty(CHECKED_PROPERTY):
        return
    window.setProperty(CHECKED_PROPERTY, "1")
    try:
        local = ADDON.getAddonInfo("version")
        remote = api.get("/kodi/addon").get("version", "")
        if _version(remote) <= _version(local):
            return
        if not xbmcgui.Dialog().yesno(api.addon_name(), tr(30040).format(local, remote)):
            return
        _install(api.get("/kodi/addon.zip", raw=True))
        xbmcgui.Dialog().ok(api.addon_name(), tr(30041).format(remote))
    except LoginCancelled:
        pass
    except ApiError as err:
        if err.status == 0:
            api.offer_settings(err)
        else:
            xbmcgui.Dialog().notification(api.addon_name(), tr(30042).format(err), xbmcgui.NOTIFICATION_ERROR)
    except (ValueError, zipfile.BadZipFile, OSError) as err:
        xbmcgui.Dialog().notification(api.addon_name(), tr(30042).format(err), xbmcgui.NOTIFICATION_ERROR)
