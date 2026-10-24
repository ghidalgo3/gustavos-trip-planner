import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import type { CurrentUser } from "../api/api";
import { identifyUser, trackBehavior, trackPage } from "./telemetry";

export default function BehaviorTracking({ user }: { user?: CurrentUser }) {
  const { pathname, search } = useLocation();
  const previousPage = useRef<string | undefined>(undefined);
  const previousUser = useRef<string | undefined>(undefined);
  const onboardingViewed = useRef(false);
  const creating = useRef(false);

  useEffect(() => {
    if (previousPage.current !== pathname) {
      previousPage.current = pathname;
      trackPage(pathname);
    }
  }, [pathname]);

  useEffect(() => {
    const id = user?.isAuthenticated ? user.id : undefined;
    identifyUser(id);
    if (id && previousUser.current !== id)
      trackBehavior("session_authenticated");
    previousUser.current = id;
    if (id && !user?.completedOnboarding && !onboardingViewed.current) {
      onboardingViewed.current = true;
      trackBehavior("onboarding_viewed");
    }
  }, [user?.id, user?.isAuthenticated, user?.completedOnboarding]);

  useEffect(() => {
    const open =
      pathname === "/" && new URLSearchParams(search).get("create") === "1";
    if (open && !creating.current) trackBehavior("trip_creation_started");
    creating.current = open;
  }, [pathname, search]);

  return null;
}
