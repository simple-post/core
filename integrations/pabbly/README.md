# SimplePost for Pabbly Connect

Send an approved content item from Airtable or another Pabbly trigger to SimplePost as a text draft or a scheduled post. The connector uses a SimplePost API key and lets the workflow select one connected social account. A stable source record ID lets a replay return the original post.

## Try the workflow with API (Pabbly)

1. Connect a test social account in SimplePost. Create a key on the [API Keys page](https://app.simplepost.social/api-keys). The hosted API requires Pro or an active free trial.
2. In Pabbly Connect, add your source trigger, then add **API (Pabbly)** and send a `GET` request to `https://app.simplepost.social/api/v1/accounts`. Use the API module's bearer credential option and select the `id` of a connected account that can publish.
3. Add an API step with method `POST` and URL `https://app.simplepost.social/api/v1/integrations/pabbly/posts`. Select the encoded form payload type and use the same credential. Map these body parameters.

| Parameter        | Example or mapping                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `accountId`      | ID of the connected account                                                                                 |
| `message`        | Approved copy from your source                                                                              |
| `postingMode`    | `draft` or `schedule`                                                                                       |
| `idempotencyKey` | A namespaced source ID such as `airtable:content:rec123`. Keep it stable for a replay.                      |
| `scheduledFor`   | A future UTC timestamp such as `2030-05-01T14:00:00Z` for `schedule`. Leave this parameter out for `draft`. |

4. Run the step with a new source item. A successful create returns HTTP 201 and `post.id` and `post.status`. Replaying the same key returns HTTP 200, `replayed: true`, and the original ID. Use a distinct key for a separate post. Editing a previously created draft takes place in SimplePost.

Use Pabbly's encoded form fields for this request. Pabbly encodes each value before sending it so SimplePost receives quotes and newlines in the original message. For media, multiple accounts, and other post options, use the JSON endpoint at `/api/v1/posts`.

## Configure the private native connector

[portal.json](portal.json) records the field and endpoint values for manual setup in the [Pabbly developer portal](https://connect.pabbly.com/v2/dev/apps). The values correspond to Pabbly's [authentication](https://docs.pabbly.com/pabbly/doc/how-to-configuring-details-and-authentication-method-within-pabbly-connect.2426) and [inbuilt action](https://docs.pabbly.com/pabbly/doc/configuring-inbuilt-actions-for-your-application.2430) fields.

1. Create the SimplePost app with **Bearer Token** authentication. Use the hosted origin in the definition. Add the validator as an **App Auth Validator** inbuilt action and save it.
2. Add **List Posting Accounts** as a **Dropdown & Custom Fields** inbuilt action. Paste the endpoint from `accountDropdown.url` as shown in Pabbly's [Select and Transform guide](https://docs.pabbly.com/pabbly/doc/how-to-use-select-and-transform-api-to-transform-your-incoming-api-response.21055). Use the `accounts` array as the source, `label` for display, and `id` for the value. The transform excludes preview-only accounts and accounts that need reconnection.
3. Create the two action events defined in `actions`. Use the method, endpoint, and form content type from `postRequest`. Add the account dropdown as an inbuilt action and map its value to `accountId`. Map the remaining required fields from the action's field list. Set `postingMode` to the static value for that action. With the form body configured, keep **Request Body (Raw JSON)** empty.
4. Test both actions in a private workflow on a test account. Try a message containing quotes, line breaks, and emoji. Check for a rejected key, an empty account list, a past schedule, and a replay that preserves the same post ID. Confirm the dropdown omits preview-only accounts and accounts that need reconnection. Verify Pabbly sends a form-encoded body before sharing the workflow.

The form inputs require a Scheduler deployment that includes this change. Pabbly's [public listing review](https://forum.pabbly.com/threads/how-do-we-publish-our-app-genmagic-built-in-the-developer-portal-for-all-pabbly-connect-users.227355) is a separate step after the private workflow test.
