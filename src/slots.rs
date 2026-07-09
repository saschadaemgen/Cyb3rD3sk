//! Slot layout engine (CD-09, D-0017) — pure geometry, no state.
//!
//! A **slot** is a fixed-width content column: [`Slots::width`] logical px wide,
//! as tall as the surf zone ([`Slots::height_frac`] of the window height,
//! vertically centered), with [`Slots::gutter`] between adjacent slots. The
//! group is horizontally centered and never comes within [`Slots::min_margin`]
//! of the screen edge; the Pulse Grid glows in the gutters and margins.
//!
//! These functions are the single source of truth for where slots sit — the
//! renderer draws each slot's page/placeholder at [`slot_rects`], and the shell
//! hit-tests the cursor against the same rects. They are deterministic and
//! side-effect-free so they can be unit-tested without a GPU or CEF (the CD-08
//! pattern).

use crate::theme::Slots;

/// Hard cap on live slots — the four-column product vision. The per-view arrays
/// in [`crate::browser`] are sized `MAX_SLOTS + 1` (the slots plus the one
/// shared internal overlay view), so this is also a compile-time bound.
pub const MAX_SLOTS: usize = 4;

/// A slot rectangle in device pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    /// Does this rect contain the device-pixel point `(px, py)`?
    #[allow(dead_code)] // wired into the mouse router in Stage C
    pub fn contains(&self, px: f32, py: f32) -> bool {
        px >= self.x && px <= self.x + self.w && py >= self.y && py <= self.y + self.h
    }
}

/// How many slots of `t.width` (+ gutter) fit in `width_px` device pixels while
/// keeping at least `t.min_margin` on each side — clamped to `[1, MAX_SLOTS]`
/// (and to `t.max_count`). Never returns fewer than 1: a window narrower than a
/// single slot still shows one column (it just overflows the margins).
pub fn max_slots(width_px: u32, scale: f32, t: &Slots) -> usize {
    let unit = t.width * scale;
    let gutter = t.gutter * scale;
    let avail = width_px as f32 - 2.0 * t.min_margin * scale;
    let cap = (t.max_count as usize).clamp(1, MAX_SLOTS);
    if avail < unit {
        return 1;
    }
    // Largest n with n*unit + (n-1)*gutter <= avail.
    let n = ((avail + gutter) / (unit + gutter)).floor() as usize;
    n.clamp(1, cap)
}

/// The device-pixel rectangles for `n` slots on a `width`×`height` surface: each
/// `t.width` wide and `height_frac·height` tall (vertically centered), separated
/// by `t.gutter`, the whole group centered horizontally. `n` is clamped to at
/// least 1. Sizes are rounded to whole pixels so the columns stay crisp.
pub fn slot_rects(width: u32, height: u32, n: usize, scale: f32, t: &Slots) -> Vec<Rect> {
    let n = n.max(1);
    let unit = (t.width * scale).round();
    let gutter = (t.gutter * scale).round();
    let zh = (height as f32 * t.height_frac).round();
    let zy = ((height as f32 - zh) * 0.5).round();
    let total = unit * n as f32 + gutter * (n as f32 - 1.0);
    let x0 = ((width as f32 - total) * 0.5).round();
    (0..n)
        .map(|i| Rect {
            x: x0 + i as f32 * (unit + gutter),
            y: zy,
            w: unit,
            h: zh,
        })
        .collect()
}

/// The centered index of the slot rect nearest the device-pixel x — used by the
/// mouse router to pick a slot even when the cursor is in a gutter/margin. `n`
/// is assumed ≥ 1. Returns a slot index in `0..n`.
#[allow(dead_code)] // wired into the mouse router in Stage C
pub fn nearest_slot(width: u32, height: u32, n: usize, scale: f32, t: &Slots, px: f32) -> usize {
    let rects = slot_rects(width, height, n.max(1), scale, t);
    let mut best = 0usize;
    let mut best_d = f32::INFINITY;
    for (i, r) in rects.iter().enumerate() {
        let cx = r.x + r.w * 0.5;
        let d = (px - cx).abs();
        if d < best_d {
            best_d = d;
            best = i;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The token values the "cyber" theme ships (theme.toml [slots]).
    fn slots() -> Slots {
        Slots {
            width: 1200.0,
            gutter: 24.0,
            min_margin: 48.0,
            height_frac: 0.70,
            max_count: 4,
            active_line: 2.0,
            placeholder_fill: 0.05,
            placeholder_glyph: 0.18,
        }
    }

    #[test]
    fn max_slots_matches_the_briefing_widths() {
        let t = slots();
        // "4 on 5120, 1 on 1920" — plus the intermediate ultrawide steps.
        assert_eq!(max_slots(1920, 1.0, &t), 1);
        assert_eq!(max_slots(2560, 1.0, &t), 2);
        assert_eq!(max_slots(3840, 1.0, &t), 3);
        assert_eq!(max_slots(5120, 1.0, &t), 4);
    }

    #[test]
    fn max_slots_never_below_one_and_capped_at_four() {
        let t = slots();
        // Narrower than a single slot -> still one column (never zero).
        assert_eq!(max_slots(800, 1.0, &t), 1);
        assert_eq!(max_slots(1, 1.0, &t), 1);
        // Absurdly wide -> capped at the four-column vision.
        assert_eq!(max_slots(20000, 1.0, &t), 4);
    }

    #[test]
    fn max_slots_honours_dpi_scale() {
        let t = slots();
        // At 2× DPI the slot needs twice the device px, so a 3840 panel that fits
        // three at 1× fits only one at 2× (1200·2 = 2400; 2·2400 + gutter > 3840).
        assert_eq!(max_slots(3840, 1.0, &t), 3);
        assert_eq!(max_slots(3840, 2.0, &t), 1);
    }

    #[test]
    fn max_count_token_can_lower_the_cap() {
        let mut t = slots();
        t.max_count = 2;
        assert_eq!(max_slots(5120, 1.0, &t), 2);
    }

    #[test]
    fn single_slot_is_centered_and_the_right_height() {
        let t = slots();
        let r = slot_rects(1600, 900, 1, 1.0, &t);
        assert_eq!(r.len(), 1);
        // 1200 wide, centered: x = (1600-1200)/2 = 200.
        assert_eq!(r[0].x, 200.0);
        assert_eq!(r[0].w, 1200.0);
        // 70% tall, vertically centered: h = 630, y = (900-630)/2 = 135.
        assert_eq!(r[0].h, 630.0);
        assert_eq!(r[0].y, 135.0);
    }

    #[test]
    fn four_slots_are_gutter_spaced_and_group_centered() {
        let t = slots();
        let r = slot_rects(5120, 1440, 4, 1.0, &t);
        assert_eq!(r.len(), 4);
        // Group width 4·1200 + 3·24 = 4872; x0 = (5120-4872)/2 = 124.
        assert_eq!(r[0].x, 124.0);
        // Each next slot is one unit + gutter to the right.
        assert_eq!(r[1].x, 124.0 + 1224.0);
        assert_eq!(r[2].x, 124.0 + 2.0 * 1224.0);
        assert_eq!(r[3].x, 124.0 + 3.0 * 1224.0);
        // All the same width, height and top.
        for slot in &r {
            assert_eq!(slot.w, 1200.0);
            assert_eq!(slot.h, (1440.0f32 * 0.70).round());
            assert_eq!(slot.y, r[0].y);
        }
        // Symmetric margins: left margin == right margin.
        let right_edge = r[3].x + r[3].w;
        assert_eq!(r[0].x, 5120.0 - right_edge);
    }

    #[test]
    fn gutter_between_slots_matches_the_token() {
        let t = slots();
        let r = slot_rects(5120, 1440, 3, 1.0, &t);
        let gap = r[1].x - (r[0].x + r[0].w);
        assert_eq!(gap, 24.0);
    }

    #[test]
    fn nearest_slot_picks_the_column_under_and_around_the_cursor() {
        let t = slots();
        let r = slot_rects(5120, 1440, 4, 1.0, &t);
        // Dead-centre of each slot resolves to that slot.
        for (i, slot) in r.iter().enumerate() {
            let cx = slot.x + slot.w * 0.5;
            assert_eq!(nearest_slot(5120, 1440, 4, 1.0, &t, cx), i);
        }
        // A point in the first gutter is nearer slot 0 or 1, not slot 3.
        let gutter_x = r[0].x + r[0].w + 12.0;
        let pick = nearest_slot(5120, 1440, 4, 1.0, &t, gutter_x);
        assert!(pick == 0 || pick == 1);
        // Far-left margin -> slot 0; far-right margin -> slot 3.
        assert_eq!(nearest_slot(5120, 1440, 4, 1.0, &t, 0.0), 0);
        assert_eq!(nearest_slot(5120, 1440, 4, 1.0, &t, 5119.0), 3);
    }

    #[test]
    fn rect_contains_is_inclusive_of_edges() {
        let r = Rect { x: 100.0, y: 50.0, w: 200.0, h: 400.0 };
        assert!(r.contains(100.0, 50.0));
        assert!(r.contains(300.0, 450.0));
        assert!(r.contains(200.0, 200.0));
        assert!(!r.contains(99.0, 200.0));
        assert!(!r.contains(200.0, 451.0));
    }
}
