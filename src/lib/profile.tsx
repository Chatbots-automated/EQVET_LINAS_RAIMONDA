"use client";

import { createContext, useContext } from "react";

// The signed-in account's full name (profiles.full_name), loaded once by the
// Shell. Used to pre-fill "who did it" fields (vet on a visit, person who
// used a biocide...) so nobody has to type their own name every time.
const ProfileNameContext = createContext<string>("");

export const ProfileNameProvider = ProfileNameContext.Provider;

export function useProfileName() {
  return useContext(ProfileNameContext);
}
