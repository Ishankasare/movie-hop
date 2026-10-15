/** A film as the game sees it. `poster` is a TMDB poster_path (or null). */
export type Film = {
  id: number;
  title: string;
  year: string;
  poster: string | null;
};

/** A person (actor or director). `photo` is a TMDB profile_path (or null). */
export type Person = {
  id: number;
  name: string;
  photo: string | null;
};

/** How a person is linked to a particular film. */
export type Role = "cast" | "director";

export type CastMember = { person: Person; role: Role };
