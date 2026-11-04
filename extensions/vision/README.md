# vision

Pi extension. Gives text-only models vision. It describes images with a vision model that you pick, then swaps the description text in for the image block before the request leaves.

Pick the describer with `/vision-handoff`. The choice persists to the `vision` section of `~/.pi/agent/pi-craft.json`. Handoff applies to every model without native vision. Descriptions cache per image hash. One vision call covers each image set.

Without a describer, or on failure, the image becomes `[Image: description unavailable]`. No crash.

## Install

Install via the pi-craft installer (`bun run install` from repo root).

## License

MIT. See LICENSE. Upstream source retains original copyright.
