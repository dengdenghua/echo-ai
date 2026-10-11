"""Project wake-ups share the bounded canonical-state invalidation transport."""

from runtime.platform.process.invalidation_feed import InvalidationFeed
from runtime.platform.process.shared_pubsub import RedisPubSub


class ProjectChangeFeed(InvalidationFeed):
    def __init__(self, bus: RedisPubSub | None = None, *, max_subscribers: int = 1024):
        super().__init__("project:changed", bus, max_subscribers=max_subscribers)
