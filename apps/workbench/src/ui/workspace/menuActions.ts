/** 原生菜单动作与界面页面的对应关系。
 *
 * 菜单动作由 Go 侧发出（knowflick:menu 事件），这里集中判定它落到哪一页，
 * 避免把判断散在事件处理里——菜单项与页面一多，散着写必然漏。
 */

// 可导航的页面集合与工作台一致：收件箱、全部知识、测验、设置。
const menuPages = new Set(["inbox", "library", "quiz", "settings"]);

/** 把菜单动作映射到页面；不可导航的动作返回 undefined。 */
export function menuActionToPage(action: string): string | undefined {
  return menuPages.has(action) ? action : undefined;
}
