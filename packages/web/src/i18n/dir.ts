export function getDir(locale: string): 'rtl' | 'ltr' {
  return locale.startsWith('ar') || locale.startsWith('he') || locale.startsWith('fa') ? 'rtl' : 'ltr';
}
