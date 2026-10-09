/** A calendar day in the interface language; the time of day does not matter in a key list. */
export function formatDate(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(iso));
}
