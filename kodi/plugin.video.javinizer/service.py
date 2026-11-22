"""Background service: reports the resume point of movies played from the
add-on to the Javinizer-JS server (the "In progress" folder)."""
import json

import xbmc
import xbmcgui

from resources.lib import api

PLAYING_PROPERTY = "javinizer.playing"
PLUGIN_PATH = "plugin://plugin.video.javinizer"
POLL_SECONDS = 5


class ProgressPlayer(xbmc.Player):
    def __init__(self):
        super().__init__()
        self.movie_id = None
        self.position = 0.0
        self.total = 0.0

    def onAVStarted(self):
        window = xbmcgui.Window(10000)
        raw = window.getProperty(PLAYING_PROPERTY)
        window.clearProperty(PLAYING_PROPERTY)
        self.report(self.position)  # previous movie, when switched without a stop
        if not raw:
            return  # not started from the add-on
        try:
            playing = json.loads(raw)
        except ValueError:
            return
        self.movie_id = playing.get("id")
        self.position = 0.0
        self.total = 0.0
        self.poll()

    def poll(self):
        if self.movie_id and self.isPlayingVideo():
            try:
                self.position = self.getTime()
                self.total = self.getTotalTime()
            except RuntimeError:
                pass

    def report(self, position):
        if not self.movie_id:
            return
        movie_id, self.movie_id = self.movie_id, None
        api.post_quiet("/kodi/progress", {"id": movie_id, "position": position, "total": self.total})
        # Refresh progress bars / the "In progress" list we return to
        if xbmc.getInfoLabel("Container.FolderPath").startswith(PLUGIN_PATH):
            xbmc.executebuiltin("Container.Refresh")

    def onPlayBackStopped(self):
        self.report(self.position)

    def onPlayBackEnded(self):
        self.report(self.total)


def run():
    monitor = xbmc.Monitor()
    player = ProgressPlayer()
    while not monitor.waitForAbort(POLL_SECONDS):
        player.poll()


if __name__ == "__main__":
    run()
