export type SupportedLanguage =
    | 'en' // English
    | 'es' // Spanish
    | 'fr' // French
    | 'de' // German
    | 'it' // Italian
    | 'pt' // Portuguese
    | 'nl' // Dutch
    | 'ja' // Japanese
    | 'et'; // Estonian

export type Theme = 'light' | 'dark' | 'system';

export interface SystemSettings {
    /** The default display language for the application UI. */
    language: SupportedLanguage;

    /** The default color theme for the application. */
    theme: Theme;

    /** A public-facing email address for user support inquiries. */
    supportEmail: string | null;
}
