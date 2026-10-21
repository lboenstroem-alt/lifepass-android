// The hero's greeting line, "Good evening, Anna.": iOS `HomeView.greeting`
// and `HomeView.firstName`.
//
// The hour is the member's OWN clock (iOS `Calendar.current`): a greeting is
// about their time of day, unlike a venue time, which is read in Reykjavík.

/** The greeting key for an hour of the day (0 to 23). */
export function greetingKey(hour: number): 'greeting.morning' | 'greeting.afternoon' | 'greeting.evening' | 'greeting.night' {
  if (hour >= 5 && hour < 12) return 'greeting.morning';
  if (hour >= 12 && hour < 17) return 'greeting.afternoon';
  if (hour >= 17 && hour < 22) return 'greeting.evening';
  // 22:00 to 04:59: "Still awake" / "Enn á fótum".
  return 'greeting.night';
}

/**
 * The first word of the profile's full name, or null when there is none
 * (no profile yet, no name, only spaces). Never the email: a member with no
 * stored name is "there" / "þú" (`home.name_fallback`), not their address.
 * Split on spaces only, as Swift's `split(separator: " ")` does.
 */
export function firstNameOf(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const first = fullName.split(' ').find((part) => part.length > 0);
  return first ?? null;
}

/** The avatar's letter: the first character of the name shown, upper case (iOS `firstName.prefix(1).uppercased()`). */
export function avatarInitial(name: string): string {
  const first = Array.from(name)[0];
  return first ? first.toUpperCase() : '';
}
