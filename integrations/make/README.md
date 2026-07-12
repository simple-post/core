# SimplePost for Make

This directory contains source-controlled component definitions for a SimplePost Make Custom App. Make custom apps are configured in the Make Developer Hub rather than published from npm, so the files map directly to the app's Base, Connection, and Module configuration tabs.

## Included modules

- **Create a post** — publish now, schedule, or save a draft with all Scheduler API fields.
- **Validate a post** — validate content and platform settings before creating it.
- **List accounts** — retrieve connected SimplePost account IDs for use in scenarios.

## Install in Make

1. In the Make Developer Hub, create a Custom App named **SimplePost**.
2. Configure the Connection parameters and communication using `definition/connection-parameters.json` and `definition/connection.json`.
3. Configure the app Base with `definition/base.json`.
4. Create the three modules from the JSON files in `definition/modules/`, copying the communication, mappable parameters, and interface fields into their matching Make tabs.
5. Test with a SimplePost API key and production Scheduler API URL.
6. Request Make app review when the app is ready for public distribution.

Run `npm test` to validate the source-controlled definitions.

Make reviews custom apps before distributing them to all users. See Make's [Custom App review process](https://developers.make.com/custom-apps-documentation/app-review/overview) and [action module documentation](https://developers.make.com/custom-apps-documentation/app-structure/modules/action).
