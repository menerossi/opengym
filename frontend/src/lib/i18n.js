// Tiny dependency-free i18n. English source strings are the keys; locale files in
// src/locales/ map them to translations and are lazy-loaded (Vite code-splits each
// import.meta.glob entry), so the initial bundle stays English-only.
// Exercise names and instructions come from separately generated packs in src/names/ and
// src/instr/ — also lazy-loaded on language switch.
import { useSyncExternalStore } from 'react'

// UI languages. de/pt have no instruction pack upstream — instructions fall back to English.
export const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pt: 'Português (Portugal)', 'pt-BR': 'Português (Brasil)', pl: 'Polski', tr: 'Türkçe', ru: 'Русский', zh: '中文',
  ko: '한국어', hi: 'हिन्दी'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'pt-BR', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', 'pt-BR': 'pt-BR',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN'
}

const localePacks = import.meta.glob('../locales/*.js')
const instrPacks = import.meta.glob('../instr/*.js')
const namePacks = import.meta.glob('../names/*.js')

let lang = 'en'
let dict = {}
let instr = null            // { exId: [steps] } for the current language, null = English
let names = null            // { exId: displayName }, null = canonical English
let version = 0
const subs = new Set()
const notify = () => { version++; subs.forEach(f => f()) }

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}
// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []
export const exerciseName = ex => (names && names[ex?.id]) || ex?.n || ''

export async function setLang(l) {
  if (!LANGS[l]) l = 'en'
  if (l === lang && version > 0) return
  lang = l
  try {
    const [localePack, instrPack, namePack] = await Promise.all([
      l === 'en' ? null : localePacks['../locales/' + l + '.js'](),
      l === 'en' || !INSTR_LANGS.includes(l) ? null : instrPacks['../instr/' + l + '.js'](),
      l === 'en' || !namePacks['../names/' + l + '.js'] ? null : namePacks['../names/' + l + '.js']()
    ])
    dict = localePack?.default || {}
    instr = instrPack?.default || null
    names = namePack?.default || null
  } catch (e) { dict = {}; instr = null; names = null }
  notify()
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
