"""Javinizer-JS: read-only Kodi viewer for a Javinizer-js library."""
import json
import sys
from urllib.parse import parse_qsl, urlencode

import xbmc
import xbmcgui
import xbmcplugin

from resources.lib import api, updater
from resources.lib.api import ADDON, ApiError, LoginCancelled, tr

PLAYING_PROPERTY = "javinizer.playing"
BASE_URL = sys.argv[0]
HANDLE = int(sys.argv[1])


def plugin_url(**params):
    return BASE_URL + "?" + urlencode(params)


def notify(message, icon=xbmcgui.NOTIFICATION_INFO):
    xbmcgui.Dialog().notification(api.addon_name(), message, icon)


def end_directory(content=None):
    if content:
        xbmcplugin.setContent(HANDLE, content)
    xbmcplugin.endOfDirectory(HANDLE)


def folder_item(label, url, thumb="", label2=""):
    item = xbmcgui.ListItem(label, label2, offscreen=True)
    if thumb:
        item.setArt({"thumb": thumb, "icon": thumb, "poster": thumb})
    return (url, item, True)


# ── Menus ─────────────────────────────

def root_menu():
    if not api.ensure_server_url():
        xbmcplugin.endOfDirectory(HANDLE, succeeded=False)
        return
    xbmcplugin.addDirectoryItems(HANDLE, [
        folder_item(tr(30018), plugin_url(action="movies", inprogress="1", title=tr(30018))),
        folder_item(tr(30010), plugin_url(action="movies", sort="dateadded", order="desc", limit=ADDON.getSettingInt("recent_count"), title=tr(30010))),
        folder_item(tr(30011), plugin_url(action="movies", sort="code", title=tr(30011))),
        folder_item(tr(30012), plugin_url(action="movies", sort="random", limit=ADDON.getSettingInt("random_count"), title=tr(30012))),
        folder_item(tr(30013), plugin_url(action="actors", favorites="1")),
        folder_item(tr(30014), plugin_url(action="actors")),
        folder_item(tr(30015), plugin_url(action="genres")),
        folder_item(tr(30016), plugin_url(action="studios")),
        folder_item(tr(30017), plugin_url(action="search")),
    ])
    end_directory()
    updater.check_once()


def movie_item(movie):
    label = movie["title"]
    if movie["code"] and movie["code"].lower() not in label.lower():
        label = "{} - {}".format(movie["code"], label)

    item = xbmcgui.ListItem(label, offscreen=True)
    tag = item.getVideoInfoTag()
    tag.setMediaType("movie")
    tag.setTitle(label)
    tag.setOriginalTitle(movie["originalTitle"])
    tag.setPlot(movie["plot"])
    tag.setGenres(movie["genres"])
    tag.setCast([xbmc.Actor(a["name"], "", i, api.image_url(a["thumb"])) for i, a in enumerate(movie["actors"])])
    if movie["year"]:
        tag.setYear(movie["year"])
    if movie["premiered"]:
        tag.setPremiered(movie["premiered"])
    if movie["dateAdded"]:
        tag.setDateAdded(movie["dateAdded"])
    if movie["runtime"]:
        tag.setDuration(movie["runtime"] * 60)
    if movie["studio"]:
        tag.setStudios([movie["studio"]])
    if movie["director"]:
        tag.setDirectors([movie["director"]])
    resume = movie.get("resume")
    if resume:
        tag.setResumePoint(resume["position"], resume["total"])

    poster = api.image_url(movie["poster"])
    item.setArt({"poster": poster, "thumb": poster, "fanart": api.image_url(movie["fanart"])})
    item.setProperty("IsPlayable", "true")

    context = []
    if movie["actors"]:
        context.append((tr(30020), "RunPlugin({})".format(plugin_url(action="actor_pick", id=movie["id"]))))
    if movie["studio"]:
        context.append((tr(30022), "Container.Update({})".format(plugin_url(action="movies", studio=movie["studio"], title=movie["studio"]))))
    if resume:
        context.append((tr(30023), "RunPlugin({})".format(plugin_url(action="clear_progress", id=movie["id"]))))
    item.addContextMenuItems(context)

    return (plugin_url(action="play", id=movie["id"]), item, False)


def list_movies(params):
    query = {k: params[k] for k in ("sort", "order", "q", "actor", "genre", "studio", "limit", "inprogress") if params.get(k)}
    movies = api.get("/kodi/movies", query)["items"]
    if not movies:
        notify(tr(30038))

    xbmcplugin.setPluginCategory(HANDLE, params.get("title", ""))
    xbmcplugin.addDirectoryItems(HANDLE, [movie_item(m) for m in movies], len(movies))
    # First method = default: keeps the server order (alphabetical, newest, random...)
    for method in (xbmcplugin.SORT_METHOD_UNSORTED, xbmcplugin.SORT_METHOD_LABEL, xbmcplugin.SORT_METHOD_DATEADDED,
                   xbmcplugin.SORT_METHOD_VIDEO_YEAR, xbmcplugin.SORT_METHOD_DURATION):
        xbmcplugin.addSortMethod(HANDLE, method)
    end_directory("movies")


def list_actors(params):
    query = {"favorites": "1"} if params.get("favorites") == "1" else {}
    actors = api.get("/kodi/actors", query)["actors"]
    xbmcplugin.setPluginCategory(HANDLE, tr(30013 if query else 30014))
    xbmcplugin.addDirectoryItems(HANDLE, [
        folder_item(a["name"], plugin_url(action="movies", actor=a["id"], title=a["name"]), api.image_url(a["thumb"]), str(a["count"]))
        for a in actors
    ], len(actors))
    xbmcplugin.addSortMethod(HANDLE, xbmcplugin.SORT_METHOD_LABEL)
    end_directory()


def list_named(params, endpoint, key, filter_param, category_id):
    entries = api.get(endpoint)[key]
    xbmcplugin.setPluginCategory(HANDLE, tr(category_id))
    xbmcplugin.addDirectoryItems(HANDLE, [
        folder_item(e["name"], plugin_url(action="movies", title=e["name"], **{filter_param: e["name"]}), label2=str(e["count"]))
        for e in entries
    ], len(entries))
    xbmcplugin.addSortMethod(HANDLE, xbmcplugin.SORT_METHOD_LABEL)
    end_directory()


def search():
    query = xbmcgui.Dialog().input(tr(30017))
    xbmcplugin.endOfDirectory(HANDLE, succeeded=False)
    if query:
        # Open the results as their own path, so "back" doesn't ask again
        xbmc.executebuiltin("Container.Update({})".format(plugin_url(action="movies", q=query, title=query)))


def actor_pick(params):
    movies = api.get("/kodi/movies", {"ids": params["id"]})["items"]
    actors = movies[0]["actors"] if movies else []
    if not actors:
        return
    index = 0
    if len(actors) > 1:
        index = xbmcgui.Dialog().select(tr(30021), [a["name"] for a in actors])
        if index < 0:
            return
    actor = actors[index]
    xbmc.executebuiltin("Container.Update({})".format(plugin_url(action="movies", actor=actor["id"], title=actor["name"])))


def play(params):
    path = api.get("/kodi/play", {"id": params["id"]})["path"]
    # Picked up by service.py, which reports the resume point to the server
    xbmcgui.Window(10000).setProperty(PLAYING_PROPERTY, json.dumps({"id": params["id"], "path": path}))
    xbmcplugin.setResolvedUrl(HANDLE, True, xbmcgui.ListItem(path=path))


def clear_progress(params):
    api.post_quiet("/kodi/progress", {"id": params["id"], "position": 0, "total": 0})
    xbmc.executebuiltin("Container.Refresh")


def logout():
    api.logout()
    notify(tr(30034))


# ── Router ─────────────────────────────

def run():
    params = dict(parse_qsl(sys.argv[2][1:]))
    action = params.get("action")
    is_directory = action not in ("play", "actor_pick", "logout", "search", "clear_progress")
    try:
        if action is None:
            root_menu()
        elif action == "movies":
            list_movies(params)
        elif action == "actors":
            list_actors(params)
        elif action == "genres":
            list_named(params, "/kodi/genres", "genres", "genre", 30015)
        elif action == "studios":
            list_named(params, "/kodi/studios", "studios", "studio", 30016)
        elif action == "search":
            search()
        elif action == "actor_pick":
            actor_pick(params)
        elif action == "play":
            play(params)
        elif action == "clear_progress":
            clear_progress(params)
        elif action == "logout":
            logout()
    except (LoginCancelled, ApiError) as err:
        if isinstance(err, ApiError):
            if err.status == 503:
                notify(tr(30033).format(err.payload.get("done", 0), err.payload.get("total", 0)), xbmcgui.NOTIFICATION_WARNING)
            elif err.status == 0:
                api.offer_settings(err)
            elif err.status == 403:
                notify(tr(30035), xbmcgui.NOTIFICATION_ERROR)
            elif action == "play":
                notify(tr(30036).format(err), xbmcgui.NOTIFICATION_ERROR)
            else:
                notify(tr(30032).format(err), xbmcgui.NOTIFICATION_ERROR)
        if action == "play":
            xbmcplugin.setResolvedUrl(HANDLE, False, xbmcgui.ListItem())
        elif is_directory:
            xbmcplugin.endOfDirectory(HANDLE, succeeded=False)


run()
