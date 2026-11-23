/* 移动端仅消费快照库的既有 schema，不在此重复声明建表 SQL。 */

/**
 * 墨纸移动端 —— 快照阅读器
 *
 * 数据模型：设备上只保存一份从云端下载的 mozhi.db 快照（桌面端同名库）。
 * 桌面端 schema（books/chapters/articles/sources/settings）由桌面仓库维护；
 * 移动端只读大部分表，进度写回仅触碰 books.progress / current_chapter / chapter_label。
 */

export interface BookRow {
  id: number
  title: string
  author: string
  format: string
  cover_idx: number
  cover_path: string
  progress: number
  chapter_label: string
  total_chapters: number
  current_chapter: number
  sort_at: number
}

export interface TocRow {
  idx: number
  title: string
}

/** 四主题，与桌面端同源（paper/sepia/green/ink 的精确 HEX 搬运） */
export const THEMES = {
  paper: {
    key: 'paper', label: '纸',
    bg: '#F5EFE3', surface: '#FDFAF2', surface2: '#EFE7D6',
    ink: '#26221A', ink2: '#5B5344', muted: '#8D8371',
    line: '#DCD2BD', lineStrong: '#C9BCA1',
    seal: '#B5402A', sealSoft: 'rgba(181,64,42,.12)', sealFg: '#F7F1E3'
  },
  sepia: {
    key: 'sepia', label: '暖',
    bg: '#F0E4CE', surface: '#F8EFDD', surface2: '#E8DAC0',
    ink: '#33291B', ink2: '#63563E', muted: '#93836A',
    line: '#DCCBAA', lineStrong: '#C8B48C',
    seal: '#A14E2F', sealSoft: 'rgba(161,78,47,.12)', sealFg: '#F6EDD8'
  },
  green: {
    key: 'green', label: '绿',
    bg: '#CDDCD1', surface: '#DBEADF', surface2: '#C3D5C9',
    ink: '#17241E', ink2: '#3A4A42', muted: '#5C6E64',
    line: '#B7CBBB', lineStrong: '#9DB4A3',
    seal: '#A8503A', sealSoft: 'rgba(168,80,58,.13)', sealFg: '#F1F6F0'
  },
  ink: {
    key: 'ink', label: '墨',
    bg: '#141412', surface: '#1D1C19', surface2: '#24231F',
    ink: '#D8D2C4', ink2: '#A69E8C', muted: '#77705F',
    line: '#2E2C26', lineStrong: '#3C3931',
    seal: '#C05A42', sealSoft: 'rgba(192,90,66,.16)', sealFg: '#F3EEE2'
  }
} as const

export type ThemeKey = keyof typeof THEMES
export type ThemeDef = (typeof THEMES)[ThemeKey]

/** 桌面端同款封面色板（cover-0..4） */
export const COVER_PALETTE = ['#221D17', '#B5402A', '#44523F', '#33424E', '#7A5C3E']

export const DB_NAME = 'mozhi.db'
