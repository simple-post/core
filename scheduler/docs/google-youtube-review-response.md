# Google YouTube API Services Review Response

This file tracks the responses and implementation notes for the May 18, 2026 Google YouTube API Services policy review for the SimplePost Scheduler API client.

## III.D.1c - Google Cloud Project Numbers

The Scheduler API client is associated with Google Cloud project number `555578778355`.

No additional Google Cloud project numbers are configured in this repository for the Scheduler YouTube API client. If an operator deploys a fork with a separate Google Cloud project, that operator must disclose the additional project number during Google API Services review.

## III.E.4a-g - YouTube API Data Refresh, Update, and Deletion Cadence

Simple Post Scheduler does not cache YouTube videos, comments, playlists, search results, or feed data for periodic background refresh.

For connected YouTube accounts, the Scheduler stores OAuth tokens, scopes, account identifiers, and basic account metadata only while the YouTube account remains connected or while needed to complete posts the user creates or schedules.

YouTube OAuth access is refreshed on demand when Google requires a fresh access token for an authorized upload or account action. Basic YouTube account metadata is updated when the user reconnects the YouTube account.

When a user disconnects a YouTube account, the active connection record and stored tokens are deleted immediately. Account deletion and support deletion requests are processed within 30 days unless retention is required by law, fraud prevention, or security obligations.
