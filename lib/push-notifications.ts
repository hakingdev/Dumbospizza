/**
 * Push-уведомления в приложение «Dumbo Slice» идут через Expo Push API
 * (lib/push/*). Legacy FCM HTTP API (FCM_SERVER_KEY) Google отключил в 2024,
 * а в push_devices лежат Expo-токены, поэтому старый FCM-путь удалён.
 *
 * Expo не требует ключа: EXPO_ACCESS_TOKEN нужен только при включённой
 * «Enhanced push security» в проекте Expo.
 */
export function isPushConfigured(): boolean {
  return true;
}
