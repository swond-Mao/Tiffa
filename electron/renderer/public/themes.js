/**
 * 主题系统 — 移植自 OpenCodeUI
 *
 * 架构说明：
 * - 每个"主题风格"（ThemePreset）包含 light 和 dark 两套配色
 * - 用户选择 主题风格 + 日夜模式（system/light/dark）
 * - 颜色格式：HSL 不带 hsl() 包装，如 '210 90% 50%'
 * - 应用时通过 JS 注入 <style> 到 :root，动态生成 CSS 变量
 *
 * 兼容性：
 * - 旧 hex 变量名（--bg-primary 等）通过别名映射到新 HSL 变量
 * - 这样旧组件的 var(--bg-primary) 仍能正常工作
 */

// ============================================
// Types
// ============================================

/**
 * @typedef {Object} ThemeColors
 * @property {Object} background
 * @property {string} background.bg000
 * @property {string} background.bg100
 * @property {string} background.bg200
 * @property {string} background.bg300
 * @property {string} background.bg400
 * @property {Object} text
 * @property {string} text.text000
 * @property {string} text.text100
 * @property {string} text.text200
 * @property {string} text.text300
 * @property {string} text.text400
 * @property {string} text.text500
 * @property {string} text.text600
 * @property {Object} accent
 * @property {string} accent.brand
 * @property {string} accent.main000
 * @property {string} accent.main100
 * @property {string} accent.main200
 * @property {string} accent.secondary100
 * @property {Object} semantic
 * @property {string} semantic.success100
 * @property {string} semantic.success200
 * @property {string} semantic.successBg
 * @property {string} semantic.warning100
 * @property {string} semantic.warning200
 * @property {string} semantic.warningBg
 * @property {string} semantic.danger000
 * @property {string} semantic.danger100
 * @property {string} semantic.danger200
 * @property {string} semantic.dangerBg
 * @property {string} semantic.danger900
 * @property {string} semantic.info100
 * @property {string} semantic.info200
 * @property {string} semantic.infoBg
 * @property {Object} border
 * @property {string} border.border100
 * @property {string} border.border200
 * @property {string} border.border300
 * @property {Object} [special]
 * @property {string} [special.alwaysBlack]
 * @property {string} [special.alwaysWhite]
 * @property {string} [special.oncolor100]
 */

/**
 * @typedef {Object} ThemePreset
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {ThemeColors} light
 * @property {ThemeColors} dark
 */

// ============================================
// Eucalyptus 主题 - 莫兰迪色系，默认主题
// ============================================

const eucalyptusLight = {
  background: {
    bg000: '150 10% 99%', bg100: '150 12% 96%', bg200: '150 12% 93%',
    bg300: '150 10% 89%', bg400: '150 10% 85%',
  },
  text: {
    text000: '0 0% 100%', text100: '170 15% 15%', text200: '170 10% 40%',
    text300: '170 8% 55%', text400: '170 8% 70%', text500: '170 6% 78%', text600: '170 10% 85%',
  },
  accent: {
    brand: '165 45% 42%', main000: '165 40% 35%', main100: '165 45% 42%',
    main200: '165 50% 48%', secondary100: '200 45% 50%',
  },
  semantic: {
    success100: '140 40% 40%', success200: '140 35% 32%', successBg: '140 30% 94%',
    warning100: '35 80% 45%', warning200: '35 70% 38%', warningBg: '35 60% 94%',
    danger000: '5 55% 40%', danger100: '5 60% 55%', danger200: '5 65% 62%',
    dangerBg: '5 60% 96%', danger900: '5 50% 93%',
    info100: '200 50% 50%', info200: '200 45% 60%', infoBg: '200 40% 95%',
  },
  border: { border100: '160 10% 86%', border200: '160 10% 82%', border300: '160 10% 75%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

const eucalyptusDark = {
  background: {
    bg000: '210 20% 18%', bg100: '210 20% 14%', bg200: '210 20% 11%',
    bg300: '210 20% 9%', bg400: '210 25% 6%',
  },
  text: {
    text000: '0 0% 100%', text100: '210 15% 92%', text200: '210 10% 70%',
    text300: '210 8% 55%', text400: '210 8% 40%', text500: '210 6% 32%', text600: '210 10% 25%',
  },
  accent: {
    brand: '165 50% 55%', main000: '165 45% 45%', main100: '165 50% 55%',
    main200: '165 55% 65%', secondary100: '200 50% 60%',
  },
  semantic: {
    success100: '140 50% 55%', success200: '140 45% 62%', successBg: '140 30% 15%',
    warning100: '35 80% 60%', warning200: '35 75% 68%', warningBg: '35 30% 15%',
    danger000: '5 65% 60%', danger100: '5 70% 65%', danger200: '5 72% 72%',
    dangerBg: '5 30% 15%', danger900: '5 28% 22%',
    info100: '200 60% 65%', info200: '200 55% 72%', infoBg: '200 30% 15%',
  },
  border: { border100: '210 15% 22%', border200: '210 15% 26%', border300: '210 15% 32%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

// ============================================
// Claude 主题 - 暖调橙色品牌风格
// ============================================

const claudeLight = {
  background: {
    bg000: '45 40% 99%', bg100: '45 35% 96%', bg200: '45 30% 93%',
    bg300: '45 25% 90%', bg400: '45 20% 86%',
  },
  text: {
    text000: '0 0% 100%', text100: '30 10% 15%', text200: '30 8% 35%',
    text300: '30 6% 50%', text400: '30 5% 60%', text500: '30 4% 70%', text600: '30 3% 82%',
  },
  accent: {
    brand: '24 90% 50%', main000: '24 85% 45%', main100: '24 90% 50%',
    main200: '24 95% 55%', secondary100: '210 85% 50%',
  },
  semantic: {
    success100: '142 70% 40%', success200: '142 65% 32%', successBg: '142 60% 94%',
    warning100: '38 92% 48%', warning200: '32 88% 42%', warningBg: '48 90% 92%',
    danger000: '0 65% 38%', danger100: '0 72% 48%', danger200: '0 78% 58%',
    dangerBg: '0 75% 95%', danger900: '0 55% 92%',
    info100: '210 85% 48%', info200: '210 80% 58%', infoBg: '210 90% 95%',
  },
  border: { border100: '35 15% 82%', border200: '35 12% 85%', border300: '35 18% 78%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

const claudeDark = {
  background: {
    bg000: '30 3% 20%', bg100: '30 3% 15%', bg200: '30 3% 12%',
    bg300: '30 3% 9%', bg400: '0 0% 5%',
  },
  text: {
    text000: '0 0% 100%', text100: '40 20% 95%', text200: '40 10% 75%',
    text300: '40 5% 60%', text400: '40 3% 50%', text500: '40 2% 40%', text600: '40 2% 30%',
  },
  accent: {
    brand: '24 70% 55%', main000: '24 75% 50%', main100: '24 80% 58%',
    main200: '24 85% 62%', secondary100: '210 80% 60%',
  },
  semantic: {
    success100: '142 70% 50%', success200: '142 65% 60%', successBg: '142 50% 15%',
    warning100: '38 90% 55%', warning200: '38 85% 65%', warningBg: '38 50% 15%',
    danger000: '0 85% 65%', danger100: '0 70% 55%', danger200: '0 75% 65%',
    dangerBg: '0 50% 15%', danger900: '0 50% 25%',
    info100: '210 85% 60%', info200: '210 80% 70%', infoBg: '210 50% 15%',
  },
  border: { border100: '40 5% 25%', border200: '40 5% 30%', border300: '40 5% 35%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

// ============================================
// Breeze 主题 - 现代化清新护眼
// ============================================

const breezeLight = {
  background: {
    bg000: '210 20% 99%', bg100: '210 15% 96.5%', bg200: '210 12% 93.5%',
    bg300: '210 10% 90%', bg400: '210 8% 86%',
  },
  text: {
    text000: '0 0% 100%', text100: '215 15% 14%', text200: '215 10% 34%',
    text300: '215 7% 48%', text400: '215 5% 58%', text500: '215 4% 68%', text600: '215 3% 80%',
  },
  accent: {
    brand: '187 72% 42%', main000: '187 68% 36%', main100: '187 72% 42%',
    main200: '187 75% 48%', secondary100: '230 65% 55%',
  },
  semantic: {
    success100: '152 60% 38%', success200: '152 55% 30%', successBg: '152 50% 94%',
    warning100: '42 85% 46%', warning200: '36 80% 40%', warningBg: '48 80% 93%',
    danger000: '4 60% 36%', danger100: '4 65% 46%', danger200: '4 70% 56%',
    dangerBg: '4 65% 95%', danger900: '4 50% 92%',
    info100: '215 75% 48%', info200: '215 70% 58%', infoBg: '215 80% 95%',
  },
  border: { border100: '210 10% 83%', border200: '210 8% 86%', border300: '210 12% 78%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

const breezeDark = {
  background: {
    bg000: '215 8% 20%', bg100: '215 8% 14%', bg200: '215 8% 11%',
    bg300: '215 8% 8%', bg400: '215 10% 5%',
  },
  text: {
    text000: '0 0% 100%', text100: '210 15% 93%', text200: '210 8% 72%',
    text300: '210 5% 58%', text400: '210 3% 48%', text500: '210 2% 38%', text600: '210 2% 28%',
  },
  accent: {
    brand: '187 65% 52%', main000: '187 60% 46%', main100: '187 65% 52%',
    main200: '187 68% 58%', secondary100: '230 60% 62%',
  },
  semantic: {
    success100: '152 55% 48%', success200: '152 50% 58%', successBg: '152 40% 14%',
    warning100: '42 82% 52%', warning200: '42 78% 62%', warningBg: '42 45% 14%',
    danger000: '4 75% 62%', danger100: '4 65% 52%', danger200: '4 68% 62%',
    dangerBg: '4 45% 14%', danger900: '4 42% 24%',
    info100: '215 75% 58%', info200: '215 70% 68%', infoBg: '215 45% 14%',
  },
  border: { border100: '215 6% 24%', border200: '215 5% 28%', border300: '215 7% 32%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

// ============================================
// Sakura 主题 - 粉白色系
// ============================================

const sakuraLight = {
  background: {
    bg000: '350 30% 99%', bg100: '350 25% 97%', bg200: '350 20% 94%',
    bg300: '350 18% 90%', bg400: '350 15% 86%',
  },
  text: {
    text000: '0 0% 100%', text100: '340 20% 15%', text200: '340 15% 35%',
    text300: '340 10% 50%', text400: '340 8% 62%', text500: '340 6% 72%', text600: '340 5% 82%',
  },
  accent: {
    brand: '340 70% 55%', main000: '340 65% 48%', main100: '340 70% 55%',
    main200: '340 75% 62%', secondary100: '320 60% 50%',
  },
  semantic: {
    success100: '140 50% 42%', success200: '140 45% 35%', successBg: '140 40% 94%',
    warning100: '35 85% 48%', warning200: '35 80% 40%', warningBg: '35 70% 93%',
    danger000: '350 65% 45%', danger100: '350 70% 55%', danger200: '350 75% 62%',
    dangerBg: '350 60% 95%', danger900: '350 50% 92%',
    info100: '200 70% 50%', info200: '200 65% 58%', infoBg: '200 60% 95%',
  },
  border: { border100: '350 15% 88%', border200: '350 12% 84%', border300: '350 10% 78%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

const sakuraDark = {
  background: {
    bg000: '340 15% 18%', bg100: '340 15% 14%', bg200: '340 12% 11%',
    bg300: '340 10% 9%', bg400: '340 8% 6%',
  },
  text: {
    text000: '0 0% 100%', text100: '350 15% 92%', text200: '350 10% 72%',
    text300: '350 8% 58%', text400: '350 6% 48%', text500: '350 5% 38%', text600: '350 4% 28%',
  },
  accent: {
    brand: '340 65% 60%', main000: '340 60% 52%', main100: '340 65% 60%',
    main200: '340 70% 68%', secondary100: '320 55% 62%',
  },
  semantic: {
    success100: '140 55% 52%', success200: '140 50% 60%', successBg: '140 35% 14%',
    warning100: '35 85% 58%', warning200: '35 80% 65%', warningBg: '35 30% 14%',
    danger000: '350 75% 62%', danger100: '350 70% 58%', danger200: '350 72% 68%',
    dangerBg: '350 30% 14%', danger900: '350 25% 22%',
    info100: '200 75% 62%', info200: '200 70% 70%', infoBg: '200 30% 14%',
  },
  border: { border100: '340 10% 24%', border200: '340 8% 28%', border300: '340 6% 34%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

// ============================================
// Ocean 主题 - 蓝白色系
// ============================================

const oceanLight = {
  background: {
    bg000: '215 40% 99%', bg100: '215 35% 97%', bg200: '215 30% 94%',
    bg300: '215 25% 90%', bg400: '215 20% 86%',
  },
  text: {
    text000: '0 0% 100%', text100: '220 25% 15%', text200: '220 20% 35%',
    text300: '220 15% 50%', text400: '220 12% 62%', text500: '220 10% 72%', text600: '220 8% 82%',
  },
  accent: {
    brand: '215 80% 52%', main000: '215 75% 45%', main100: '215 80% 52%',
    main200: '215 85% 58%', secondary100: '200 70% 50%',
  },
  semantic: {
    success100: '155 60% 40%', success200: '155 55% 32%', successBg: '155 50% 94%',
    warning100: '40 90% 48%', warning200: '35 85% 40%', warningBg: '40 80% 93%',
    danger000: '0 70% 45%', danger100: '0 75% 55%', danger200: '0 80% 62%',
    dangerBg: '0 70% 95%', danger900: '0 55% 92%',
    info100: '215 80% 50%', info200: '215 75% 58%', infoBg: '215 70% 95%',
  },
  border: { border100: '215 20% 86%', border200: '215 18% 82%', border300: '215 15% 76%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

const oceanDark = {
  background: {
    bg000: '220 30% 16%', bg100: '220 30% 12%', bg200: '220 28% 10%',
    bg300: '220 25% 8%', bg400: '220 20% 5%',
  },
  text: {
    text000: '0 0% 100%', text100: '215 20% 92%', text200: '215 15% 72%',
    text300: '215 12% 58%', text400: '215 10% 48%', text500: '215 8% 38%', text600: '215 6% 28%',
  },
  accent: {
    brand: '215 75% 58%', main000: '215 70% 50%', main100: '215 75% 58%',
    main200: '215 80% 65%', secondary100: '200 65% 60%',
  },
  semantic: {
    success100: '155 65% 55%', success200: '155 60% 62%', successBg: '155 35% 14%',
    warning100: '40 90% 60%', warning200: '40 85% 68%', warningBg: '40 30% 14%',
    danger000: '0 80% 62%', danger100: '0 75% 58%', danger200: '0 78% 68%',
    dangerBg: '0 30% 14%', danger900: '0 25% 22%',
    info100: '215 80% 62%', info200: '215 75% 70%', infoBg: '215 30% 14%',
  },
  border: { border100: '220 15% 22%', border200: '220 12% 26%', border300: '220 10% 32%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

// ============================================
// Dracula 主题 - 官方 Dracula 预设
// ============================================

const draculaLight = {
  background: {
    bg000: '48 100% 96%', bg100: '48 88% 94%', bg200: '45 52% 90%',
    bg300: '240 19% 88%', bg400: '240 19% 84%',
  },
  text: {
    text000: '0 0% 100%', text100: '0 0% 12%', text200: '49 18% 36%',
    text300: '46 14% 46%', text400: '45 12% 58%', text500: '240 19% 84%', text600: '240 19% 88%',
  },
  accent: {
    brand: '252 54% 54%', main000: '336 78% 36%', main100: '252 54% 54%',
    main200: '265 89% 78%', secondary100: '198 96% 30%',
  },
  semantic: {
    success100: '114 84% 24%', success200: '120 90% 30%', successBg: '48 100% 96%',
    warning100: '24 78% 36%', warning200: '54 78% 36%', warningBg: '48 100% 96%',
    danger000: '6 66% 48%', danger100: '12 72% 54%', danger200: '0 100% 67%',
    dangerBg: '48 100% 96%', danger900: '240 19% 84%',
    info100: '198 96% 30%', info200: '204 100% 42%', infoBg: '48 100% 96%',
  },
  border: { border100: '240 19% 88%', border200: '240 19% 84%', border300: '49 18% 36%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

const draculaDark = {
  background: {
    bg000: '231 15% 18%', bg100: '233 16% 16%', bg200: '233 17% 14%',
    bg300: '233 18% 12%', bg400: '233 20% 10%',
  },
  text: {
    text000: '0 0% 100%', text100: '60 30% 96%', text200: '60 23% 90%',
    text300: '225 27% 51%', text400: '228 16% 62%', text500: '232 14% 31%', text600: '233 17% 14%',
  },
  accent: {
    brand: '265 89% 78%', main000: '258 60% 60%', main100: '265 89% 78%',
    main200: '265 89% 78%', secondary100: '225 27% 51%',
  },
  semantic: {
    success100: '135 94% 65%', success200: '120 90% 30%', successBg: '235 14% 15%',
    warning100: '31 100% 71%', warning200: '54 78% 36%', warningBg: '235 14% 15%',
    danger000: '0 100% 67%', danger100: '12 72% 54%', danger200: '0 100% 67%',
    dangerBg: '235 14% 15%', danger900: '230 15% 24%',
    info100: '191 97% 77%', info200: '204 100% 42%', infoBg: '235 14% 15%',
  },
  border: { border100: '232 14% 31%', border200: '232 14% 31%', border300: '225 27% 51%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

// ============================================
// Obsidian 主题 - 纯黑高对比紫灰
// ============================================

const obsidianLight = {
  background: {
    bg000: '0 0% 100%', bg100: '0 0% 98%', bg200: '0 0% 95%',
    bg300: '0 0% 91%', bg400: '0 0% 86%',
  },
  text: {
    text000: '0 0% 100%', text100: '0 0% 13%', text200: '0 0% 35%',
    text300: '0 0% 44%', text400: '0 0% 67%', text500: '0 0% 74%', text600: '0 0% 83%',
  },
  accent: {
    brand: '254 80% 68%', main000: '255 82% 63%', main100: '254 80% 68%',
    main200: '258 100% 75%', secondary100: '212 93% 45%',
  },
  semantic: {
    success100: '144 92% 38%', success200: '144 92% 32%', successBg: '144 70% 94%',
    warning100: '30 100% 46%', warning200: '31 79% 58%', warningBg: '46 100% 94%',
    danger000: '353 81% 48%', danger100: '353 81% 55%', danger200: '358 96% 63%',
    dangerBg: '353 100% 96%', danger900: '353 70% 92%',
    info100: '212 93% 45%', info200: '212 100% 50%', infoBg: '212 100% 96%',
  },
  border: { border100: '0 0% 89%', border200: '0 0% 88%', border300: '0 0% 83%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

const obsidianDark = {
  background: {
    bg000: '0 0% 16%', bg100: '0 0% 13%', bg200: '0 0% 10%',
    bg300: '0 0% 8%', bg400: '0 0% 5%',
  },
  text: {
    text000: '0 0% 100%', text100: '0 0% 85%', text200: '0 0% 73%',
    text300: '0 0% 60%', text400: '0 0% 40%', text500: '0 0% 33%', text600: '0 0% 25%',
  },
  accent: {
    brand: '254 80% 68%', main000: '255 82% 63%', main100: '254 80% 68%',
    main200: '258 100% 75%', secondary100: '212 100% 50%',
  },
  semantic: {
    success100: '138 59% 54%', success200: '138 59% 60%', successBg: '138 24% 18%',
    warning100: '31 79% 58%', warning200: '59 64% 66%', warningBg: '46 24% 18%',
    danger000: '358 96% 58%', danger100: '358 96% 63%', danger200: '358 96% 69%',
    dangerBg: '353 22% 18%', danger900: '353 18% 24%',
    info100: '212 100% 50%', info200: '212 100% 58%', infoBg: '212 24% 18%',
  },
  border: { border100: '0 0% 16%', border200: '0 0% 21%', border300: '0 0% 25%' },
  special: { alwaysBlack: '0 0% 0%', alwaysWhite: '0 0% 100%', oncolor100: '0 0% 100%' },
}

// ============================================
// Theme Registry
// ============================================

const THEME_PRESETS = [
  { id: 'eucalyptus', name: 'Eucalyptus', description: '莫兰迪桉树绿，清爽冷静', light: eucalyptusLight, dark: eucalyptusDark },
  { id: 'claude', name: 'Claude', description: '暖调橙色品牌风格', light: claudeLight, dark: claudeDark },
  { id: 'breeze', name: 'Breeze', description: '冷调青绿护眼', light: breezeLight, dark: breezeDark },
  { id: 'sakura', name: 'Sakura', description: '粉白色系，温柔暖调', light: sakuraLight, dark: sakuraDark },
  { id: 'ocean', name: 'Ocean', description: '深蓝白色系，沉稳专注', light: oceanLight, dark: oceanDark },
  { id: 'dracula', name: 'Dracula', description: '官方 Dracula 预设', light: draculaLight, dark: draculaDark },
  { id: 'obsidian', name: 'Obsidian', description: '纯黑高对比紫灰', light: obsidianLight, dark: obsidianDark },
]

const DEFAULT_THEME_ID = 'eucalyptus'

// React 渲染层（SettingsPanel 主题选择器）需要读取预设列表：
// 经典 script 的 const 不挂 window，这里显式导出
window.THEME_PRESETS = THEME_PRESETS

// ============================================
// Theme Engine
// ============================================

const THEME_STYLE_ID = 'tiffa-theme-vars'

// localStorage key（从 omp 迁移到 tiffa）
const LS_THEME_KEY = 'tiffa-theme'
const LS_MODE_KEY = 'tiffa-theme-mode';

// ── 旧 key 迁移：首次检测到旧 key 时自动迁移到新 key ──
(function migrateOldThemeKeys() {
  const oldNew = [
    ['omp-theme', 'tiffa-theme'],
    ['omp-theme-mode', 'tiffa-theme-mode'],
  ]
  for (const [oldKey, newKey] of oldNew) {
    if (localStorage.getItem(oldKey) !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey))
      localStorage.removeItem(oldKey)
    }
  }
})()

/**
 * 将 ThemeColors 转换为 CSS 变量赋值字符串
 * @param {ThemeColors} theme
 * @returns {string}
 */
function themeColorsToCSSVars(theme) {
  const lines = []

  // Background
  lines.push(`--bg-000: ${theme.background.bg000};`)
  lines.push(`--bg-100: ${theme.background.bg100};`)
  lines.push(`--bg-200: ${theme.background.bg200};`)
  lines.push(`--bg-300: ${theme.background.bg300};`)
  lines.push(`--bg-400: ${theme.background.bg400};`)

  // Text
  lines.push(`--text-000: ${theme.text.text000};`)
  lines.push(`--text-100: ${theme.text.text100};`)
  lines.push(`--text-200: ${theme.text.text200};`)
  lines.push(`--text-300: ${theme.text.text300};`)
  lines.push(`--text-400: ${theme.text.text400};`)
  lines.push(`--text-500: ${theme.text.text500};`)
  lines.push(`--text-600: ${theme.text.text600};`)

  // Accent
  lines.push(`--accent-brand: ${theme.accent.brand};`)
  lines.push(`--accent-main-000: ${theme.accent.main000};`)
  lines.push(`--accent-main-100: ${theme.accent.main100};`)
  lines.push(`--accent-main-200: ${theme.accent.main200};`)
  lines.push(`--accent-secondary-100: ${theme.accent.secondary100};`)

  // Semantic
  lines.push(`--success-100: ${theme.semantic.success100};`)
  lines.push(`--success-200: ${theme.semantic.success200};`)
  lines.push(`--success-bg: ${theme.semantic.successBg};`)
  lines.push(`--warning-100: ${theme.semantic.warning100};`)
  lines.push(`--warning-200: ${theme.semantic.warning200};`)
  lines.push(`--warning-bg: ${theme.semantic.warningBg};`)
  lines.push(`--danger-000: ${theme.semantic.danger000};`)
  lines.push(`--danger-100: ${theme.semantic.danger100};`)
  lines.push(`--danger-200: ${theme.semantic.danger200};`)
  lines.push(`--danger-bg: ${theme.semantic.dangerBg};`)
  lines.push(`--danger-900: ${theme.semantic.danger900};`)
  lines.push(`--info-100: ${theme.semantic.info100};`)
  lines.push(`--info-200: ${theme.semantic.info200};`)
  lines.push(`--info-bg: ${theme.semantic.infoBg};`)

  // Border
  lines.push(`--border-100: ${theme.border.border100};`)
  lines.push(`--border-200: ${theme.border.border200};`)
  lines.push(`--border-300: ${theme.border.border300};`)

  // Special
  if (theme.special) {
    if (theme.special.alwaysBlack) lines.push(`--always-black: ${theme.special.alwaysBlack};`)
    if (theme.special.alwaysWhite) lines.push(`--always-white: ${theme.special.alwaysWhite};`)
    if (theme.special.oncolor100) lines.push(`--oncolor-100: ${theme.special.oncolor100};`)
  }

  // ── Legacy aliases（兼容旧 hex 变量名）──
  // 这些别名让旧组件的 var(--bg-primary) 等仍能正常工作
  lines.push(`--bg-primary: hsl(${theme.background.bg200});`)
  lines.push(`--bg-secondary: hsl(${theme.background.bg100});`)
  lines.push(`--bg-tertiary: hsl(${theme.accent.main000});`)
  lines.push(`--bg-surface: hsl(${theme.background.bg200});`)
  lines.push(`--bg-hover: hsl(${theme.background.bg300});`)
  lines.push(`--bg-active: hsl(${theme.background.bg400});`)
  lines.push(`--text-primary: hsl(${theme.text.text100});`)
  lines.push(`--text-secondary: hsl(${theme.text.text200});`)
  lines.push(`--text-muted: hsl(${theme.text.text400});`)
  lines.push(`--accent: hsl(${theme.accent.main000});`)
  lines.push(`--accent-hover: hsl(${theme.accent.main100});`)
  lines.push(`--accent-light: hsl(${theme.accent.main000} / 0.15);`)
  lines.push(`--border: hsl(${theme.border.border200});`)
  lines.push(`--danger: hsl(${theme.semantic.danger000});`)
  lines.push(`--success: hsl(${theme.semantic.success100});`)
  lines.push(`--warning: hsl(${theme.semantic.warning100});`)
  lines.push(`--info: hsl(${theme.semantic.info100});`)
  lines.push(`--user-bg: hsl(${theme.background.bg200});`)
  lines.push(`--assistant-bg: transparent;`)
  lines.push(`--tool-bg: hsl(${theme.background.bg100});`)

  return lines.join('\n  ')
}

/**
 * 判断系统当前是否为暗色模式
 * @returns {boolean}
 */
function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 获取当前应使用的模式
 * @param {string} modeSetting - 'system' | 'light' | 'dark'
 * @returns {'light' | 'dark'}
 */
function resolveMode(modeSetting) {
  if (modeSetting === 'light') return 'light'
  if (modeSetting === 'dark') return 'dark'
  return systemPrefersDark() ? 'dark' : 'light'
}

/**
 * 应用主题到 DOM
 * @param {string} presetId - 主题预设 ID
 * @param {'light'|'dark'} resolvedMode - 已解析的模式
 */
function applyThemeToDOM(presetId, resolvedMode) {
  const preset = THEME_PRESETS.find(p => p.id === presetId)
  if (!preset) return

  const colors = resolvedMode === 'light' ? preset.light : preset.dark
  const cssVars = themeColorsToCSSVars(colors)

  // 重建 <style> 元素（而非复用）：Vite 构建后 styles.css 的 <link>
  // 位于 themes.js 之后，旧元素若停留在 link 之前会被 :root fallback 覆盖；
  // 重建并 appendChild 保证排到 head 末尾，主题变量始终生效。
  const oldEl = document.getElementById(THEME_STYLE_ID)
  if (oldEl) oldEl.remove()
  const styleEl = document.createElement('style')
  styleEl.id = THEME_STYLE_ID
  document.head.appendChild(styleEl)
  styleEl.textContent = `:root {\n  ${cssVars}\n}`

  // 设置 data-mode 属性（用于 CSS 选择器）
  document.documentElement.setAttribute('data-mode', resolvedMode)

  // 更新 color-scheme（影响原生控件主题）
  document.documentElement.style.colorScheme = resolvedMode
}

/**
 * 初始化主题系统
 * @returns {{ presetId: string, mode: string, resolvedMode: string }}
 */
function initTheme() {
  const presetId = localStorage.getItem(LS_THEME_KEY) || DEFAULT_THEME_ID
  const mode = localStorage.getItem(LS_MODE_KEY) || 'system'
  const resolvedMode = resolveMode(mode)

  applyThemeToDOM(presetId, resolvedMode)

  // 监听系统主题变化（当 mode=system 时自动跟随）
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', () => {
    const currentMode = localStorage.getItem(LS_MODE_KEY) || 'system'
    if (currentMode === 'system') {
      const currentPreset = localStorage.getItem(LS_THEME_KEY) || DEFAULT_THEME_ID
      applyThemeToDOM(currentPreset, resolveMode('system'))
    }
  })

  return { presetId, mode, resolvedMode }
}

/**
 * 切换主题预设
 * @param {string} presetId
 */
function setThemePreset(presetId) {
  localStorage.setItem(LS_THEME_KEY, presetId)
  const mode = localStorage.getItem(LS_MODE_KEY) || 'system'
  applyThemeToDOM(presetId, resolveMode(mode))
}

/**
 * 切换日夜模式
 * @param {'system'|'light'|'dark'} mode
 */
function setThemeMode(mode) {
  localStorage.setItem(LS_MODE_KEY, mode)
  const presetId = localStorage.getItem(LS_THEME_KEY) || DEFAULT_THEME_ID
  applyThemeToDOM(presetId, resolveMode(mode))
}

/**
 * 循环切换模式：light → dark → system → light
 */
function cycleThemeMode() {
  const current = localStorage.getItem(LS_MODE_KEY) || 'system'
  const modes = ['light', 'dark', 'system']
  const idx = modes.indexOf(current)
  const next = modes[(idx + 1) % modes.length]
  setThemeMode(next)
  return next
}

/**
 * 获取当前主题信息
 * @returns {{ presetId: string, mode: string, resolvedMode: string }}
 */
function getCurrentTheme() {
  const presetId = localStorage.getItem(LS_THEME_KEY) || DEFAULT_THEME_ID
  const mode = localStorage.getItem(LS_MODE_KEY) || 'system'
  return { presetId, mode, resolvedMode: resolveMode(mode) }
}

// ── 早期注入：本脚本在 <head> 中同步执行，此处立即把主题变量写进 :root ──
// 为什么必需：body 一开始渲染就要显示全屏启动遮罩 .startup-overlay，
// 而 styles.css 的 :root fallback 硬编码为 Eucalyptus Dark。若等到
// app.js 的 initTheme() 才注入，浅色主题用户会先看到一帧深色遮罩再跳变。
// 这里只调 applyThemeToDOM：不写 localStorage、不注册 matchMedia 监听，
// 完全无副作用，之后 app.js 再调 initTheme() 是幂等的。
;(function applyThemeEarly() {
  try {
    const presetId = localStorage.getItem(LS_THEME_KEY) || DEFAULT_THEME_ID
    const mode = localStorage.getItem(LS_MODE_KEY) || 'system'
    applyThemeToDOM(presetId, resolveMode(mode))
  } catch (_) {
    // 兜底：任何异常都沿用 styles.css 里的 fallback 变量，不阻塞启动
  }
})()
