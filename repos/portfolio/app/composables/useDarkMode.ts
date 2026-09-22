export function useDarkMode() {
  const isDark = useState('isDark', () => false)

  function apply() {
    if (import.meta.client) {
      document.documentElement.classList.toggle('dark', isDark.value)
      localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
    }
  }

  function toggle() {
    isDark.value = !isDark.value
    apply()
  }

  if (import.meta.client) {
    const stored = localStorage.getItem('theme')
    isDark.value = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches
    apply()
  }

  return { isDark, toggle }
}
