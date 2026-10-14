# System Settings

System settings allow administrators to configure the global look and theme of the application. These settings apply to all users.

## Configuration

### Language

This setting determines the default display language for the application UI. The selected language will be used for all interface elements, including menus, labels, and messages.

> **Important:** When the language is changed, the backend (API) language will only change after a restart of the server. The frontend will update immediately.

Supported languages:

- English
- German
- French
- Estonian
- Spanish
- Italian
- Portuguese
- Dutch
- Greek
- Japanese

### Date Format

This setting controls how dates and times are shown to every user across the application, including the archive, search results, email details and the audit log.

| Option                                | Example                                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| Follow the language setting (default) | The conventions of the language selected above              |
| ISO 8601                              | `2026-10-14`, and `2026-10-14T10:00:00+02:00` with the time |
| European                              | `14/10/2026 10:00:00`                                       |
| US                                    | `10/14/2026 10:00:00`                                       |

Times are shown in each viewer's own time zone. The ISO 8601 option also shows the UTC offset, so an audit entry or email timestamp can be compared exactly by reviewers in different time zones. A preview under the setting shows the current time in the selected format before you save.

### Default Theme

This setting controls the default color theme for the application. Users can choose between light, dark, or system default. The system default theme will sync with the user's operating system theme.

### Support Email

This setting allows administrators to provide a public-facing email address for user support inquiries. This email address may be displayed on error pages or in other areas where users may need to contact support.
