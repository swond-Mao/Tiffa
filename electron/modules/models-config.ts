/**
 * models.yml 清洗与校验（UI 写入 / 启动自愈共用，纯函数无 Electron 依赖）
 *
 * 内核对自定义 provider 的 schema 校验极严：定义了 models 时 apiKey 必填（或 auth: "none"）、
 * contextWindow/maxTokens/cost.* 必须是数字；任一不满足 → 整个 providers 配置被禁用 →
 * 无可用模型 → 内核 rpc-ui 启动直接 exit(1)，Tiffa 表现为进程反复崩溃重启。
 * sanitizeModelsConfig 修「能安全修的」（幂等）；validateModelsConfig 拦「必须用户决定的」。
 */

type _SanitizeAny = Record<string, unknown>;

function _coerceNumField(obj: _SanitizeAny, key: string): boolean {
  const v = obj[key];
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    obj[key] = Number(v);
    return true;
  }
  return false;
}

/** 幂等清洗：返回是否有改动。修复项：缺失/空串 apiKey 补 "none"；数字字段字符串化转回数字。 */
export function sanitizeModelsConfig(data: unknown): { changed: boolean } {
  let changed = false;
  const providers = (data as _SanitizeAny | null)?.providers;
  if (!providers || typeof providers !== 'object') return { changed };
  for (const p of Object.values(providers as Record<string, unknown>)) {
    if (!p || typeof p !== 'object') continue;
    const prov = p as _SanitizeAny;
    // 空 apiKey（含纯空白）→ "none"
    if (typeof prov.apiKey === 'string' && prov.apiKey.trim() === '' && prov.auth === undefined) {
      prov.apiKey = 'none';
      changed = true;
    }
    // 有 baseUrl 但整行缺 apiKey 且未声明 auth → 补 "none"（keyless 端点惯例）
    if (prov.apiKey === undefined && prov.auth === undefined && typeof prov.baseUrl === 'string' && prov.baseUrl) {
      prov.apiKey = 'none';
      changed = true;
    }
    if (Array.isArray(prov.models)) {
      for (const m of prov.models) {
        if (!m || typeof m !== 'object') continue;
        const mo = m as _SanitizeAny;
        changed = _coerceNumField(mo, 'contextWindow') || changed;
        changed = _coerceNumField(mo, 'maxTokens') || changed;
        if (mo.cost && typeof mo.cost === 'object') {
          const co = mo.cost as _SanitizeAny;
          for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) {
            changed = _coerceNumField(co, k) || changed;
          }
        }
      }
    }
  }
  return { changed };
}

/** 轻量 schema 校验（语义对齐内核）：返回中文错误列表，空数组 = 通过。 */
export function validateModelsConfig(data: unknown): string[] {
  const errors: string[] = [];
  const root = data as _SanitizeAny | null;
  if (!root || typeof root !== 'object') return errors;
  const providers = root.providers;
  if (providers === undefined || providers === null) return errors;
  if (typeof providers !== 'object' || Array.isArray(providers)) {
    errors.push('providers 必须是「供应商标识 → 配置」的映射结构');
    return errors;
  }
  for (const [pid, p] of Object.entries(providers as Record<string, unknown>)) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      errors.push(`供应商 ${pid}: 配置必须是映射结构`);
      continue;
    }
    const prov = p as _SanitizeAny;
    if (typeof prov.baseUrl !== 'string' || !prov.baseUrl.trim()) {
      errors.push(`供应商 ${pid}: API 地址 (baseUrl) 不能为空`);
    }
    if (!Array.isArray(prov.models)) continue;
    const hasKey = typeof prov.apiKey === 'string' && prov.apiKey.length > 0;
    const authNone = prov.auth === 'none';
    if (!hasKey && !authNone) {
      errors.push(`供应商 ${pid}: 定义了模型但缺少 apiKey（本地无鉴权服务请填 none）`);
    }
    (prov.models as unknown[]).forEach((m, i) => {
      if (!m || typeof m !== 'object' || Array.isArray(m)) {
        errors.push(`供应商 ${pid} 第 ${i + 1} 个模型: 配置必须是映射结构`);
        return;
      }
      const mo = m as _SanitizeAny;
      const mid = typeof mo.id === 'string' && mo.id.trim() ? mo.id : `#${i + 1}`;
      if (typeof mo.id !== 'string' || !mo.id.trim()) {
        errors.push(`供应商 ${pid} 模型 ${mid}: 模型 ID 不能为空`);
      }
      for (const key of ['contextWindow', 'maxTokens']) {
        if (mo[key] !== undefined && typeof mo[key] !== 'number') {
          errors.push(`供应商 ${pid} 模型 ${mid}: ${key} 必须是数字（当前是 ${typeof mo[key]}）`);
        }
      }
      if (mo.cost && typeof mo.cost === 'object' && !Array.isArray(mo.cost)) {
        for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) {
          const v = (mo.cost as _SanitizeAny)[k];
          if (v !== undefined && typeof v !== 'number') {
            errors.push(`供应商 ${pid} 模型 ${mid}: cost.${k} 必须是数字`);
          }
        }
      }
    });
  }
  return errors;
}
