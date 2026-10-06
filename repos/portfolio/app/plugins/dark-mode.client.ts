// Sync `isDark` from the class the head script set. Waiting for app:mounted
// keeps hydration consistent: the server always renders with isDark = false.
export default defineNuxtPlugin((nuxtApp) => {
  const isDark = useState('isDark', () => false)
  nuxtApp.hook('app:mounted', () => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
})
