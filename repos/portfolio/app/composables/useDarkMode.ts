// The theme lives in the `dark` class on <html>. A head script (nuxt.config.ts)
// sets it before first paint, and plugins/dark-mode.client.ts copies it into
// `isDark` after hydration so the first client render matches the server HTML.
export function useDarkMode() {
  const isDark = useState('isDark', () => false)

  function toggle() {
    isDark.value = !isDark.value
    document.documentElement.classList.toggle('dark', isDark.value)
    try {
      localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
    } catch {
      // Storage can be blocked (private mode); the toggle still works for this visit.
    }
  }

  return { isDark, toggle }
}
