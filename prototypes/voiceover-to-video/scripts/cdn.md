# How a CDN works

## Intro
Every time a website loads in under a second, there's a good chance you never talked to its server at all. So who did?

## The problem
Say your origin server sits in Virginia, and your user is in Tokyo. Every request crosses the Pacific and back. That's around one hundred fifty milliseconds of latency, before a single byte renders.

## The edge
A content delivery network fixes this with edge servers: hundreds of points of presence, spread across the world, sitting between your users and your origin.

## The request flow
Here's the flow. The user requests an image. DNS routes them to the nearest edge. If the edge has a copy, that's a cache hit, and it responds instantly. If not, it's a cache miss: the edge fetches from the origin, stores a copy, and serves it.

## Cache hit ratio
The number that matters is your cache hit ratio: the share of requests the edge answers on its own.

## Controlling the cache
You control it with headers. Cache-Control: public, max-age thirty-one million, immutable. That tells every edge to keep this file for a year.

## The difference
Without a CDN, Tokyo waits three hundred milliseconds. With one, about twenty.

## Why it matters
So a CDN gives you three things: lower latency, less load on your origin, and protection from traffic spikes.

## Outro
If you're shipping to users worldwide, put a CDN in front of it. Subscribe for more system design, explained visually.
