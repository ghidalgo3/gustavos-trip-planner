export type MapMarkerDescription = {
  key: string;
  position: [number, number];
  button: HTMLButtonElement;
};

type Entry<T> = {
  marker: T;
  button: HTMLButtonElement;
  appClasses: string[];
  animation?: Animation;
  leaving: boolean;
};

// Retain unchanged markers, and let departing markers finish fading before removal.
export class AnimatedMapMarkers<T> {
  private entries = new Map<string, Entry<T>>();

  constructor(
    private create: (description: MapMarkerDescription) => T,
    private remove: (marker: T) => void,
  ) {}

  update(descriptions: MapMarkerDescription[], reducedMotion: boolean) {
    const wanted = new Set<string>();
    for (const description of descriptions) {
      // A changed coordinate fades between locations rather than teleporting a pin.
      const key = JSON.stringify([description.key, description.position]);
      const appClasses = [...description.button.classList];
      wanted.add(key);
      const existing = this.entries.get(key);
      if (existing) {
        const { button } = existing;
        button.replaceChildren(...description.button.childNodes);
        button.title = description.button.title;
        // The SDK adds positioning/anchor classes to this same element.
        // Only replace classes supplied by our marker description.
        for (const className of existing.appClasses) {
          if (!appClasses.includes(className))
            button.classList.remove(className);
        }
        button.classList.add(...appClasses);
        existing.appClasses = appClasses;
        button.setAttribute(
          "aria-label",
          description.button.getAttribute("aria-label") ?? "",
        );
        if (description.button.dataset.selected)
          button.dataset.selected = description.button.dataset.selected;
        else delete button.dataset.selected;
        button.onclick = description.button.onclick;
        button.disabled = false;
        button.removeAttribute("aria-hidden");
        if (existing.leaving) {
          existing.leaving = false;
          this.fade(existing, 1, reducedMotion);
        } else if (reducedMotion) {
          existing.animation?.cancel();
          existing.animation = undefined;
          button.style.opacity = "1";
        }
      } else {
        const entry: Entry<T> = {
          marker: this.create(description),
          button: description.button,
          appClasses,
          leaving: false,
        };
        this.entries.set(key, entry);
        entry.button.style.opacity = "0";
        this.fade(entry, 1, reducedMotion);
      }
    }
    for (const [key, entry] of this.entries) {
      if (wanted.has(key) || (entry.leaving && !reducedMotion)) continue;
      entry.leaving = true;
      entry.button.disabled = true;
      entry.button.setAttribute("aria-hidden", "true");
      entry.button.onclick = null;
      this.fade(entry, 0, reducedMotion, () => {
        this.remove(entry.marker);
        this.entries.delete(key);
      });
    }
  }

  private fade(
    entry: Entry<T>,
    opacity: number,
    reducedMotion: boolean,
    finished?: () => void,
  ) {
    const from =
      getComputedStyle(entry.button).opacity ||
      entry.button.style.opacity ||
      "1";
    entry.animation?.cancel();
    entry.animation = undefined;
    entry.button.style.opacity = String(opacity);
    if (reducedMotion || !entry.button.animate) {
      finished?.();
      return;
    }
    const animation = entry.button.animate([{ opacity: from }, { opacity }], {
      duration: 180,
      easing: "ease-out",
    });
    entry.animation = animation;
    animation.onfinish = () => {
      if (entry.animation !== animation) return;
      entry.animation = undefined;
      finished?.();
    };
  }

  dispose() {
    for (const entry of this.entries.values()) {
      entry.animation?.cancel();
      entry.animation = undefined;
      this.remove(entry.marker);
    }
    this.entries.clear();
  }
}
