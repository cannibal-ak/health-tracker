/**
 * App-wide constants. The Google OAuth Client ID is public by design
 * (it identifies the app, not the user) — filled in during phase 4 setup.
 */
export const APP_NAME = 'Health Tracker'

export const GOOGLE_OAUTH_CLIENT_ID = '' // set during Google Drive setup

export const DRIVE_FOLDER_NAME = 'Health Tracker Data'
export const DRIVE_REPORTS_FOLDER_NAME = 'Reports'
export const DRIVE_DB_FILENAME = 'health-data.json'
/** appProperties tag used to find our folder even if the user renames it. */
export const DRIVE_APP_TAG = { key: 'htApp', value: 'health-tracker' }
