"""Browser regression tests against a running local server (default: port 8081).

Run: python tests/reordering_test.py
Requires Playwright and Chromium, as described in tests/README.md.
Only temporary test categories and bookmarks are created and deleted.
"""

import os
import unittest
from uuid import uuid4

from playwright.sync_api import sync_playwright


class ReorderingTest(unittest.TestCase):
    def setUp(self):
        self.playwright = sync_playwright().start()
        self.addCleanup(self.playwright.stop)
        self.browser = self.playwright.chromium.launch(
            executable_path=os.getenv("CHROME_EXECUTABLE")
        )
        self.addCleanup(self.browser.close)
        base_url = os.getenv("BOOKMARKD_TEST_URL", "http://localhost:8081")
        self.context = self.browser.new_context(base_url=base_url)
        self.api = self.context.request
        self.page = self.context.new_page()
        self.name = "reorder-test-" + uuid4().hex
        response = self.api.post("/api/categories/" + self.name, data={})
        self.assertEqual(response.status, 201)
        self.category_id = response.json()["id"]
        self.addCleanup(lambda: self.api.delete("/api/categories/" + self.name))

        for i in range(7):
            response = self.api.post("/api/bookmarks", data={
                "url": f"https://example.com/{self.name}/{i}",
                "title": f"Bookmark {i}",
                "category": self.name,
                "favicon": "/static/icon.svg",
            })
            self.assertEqual(response.status, 201)
        self.ids = [b["id"] for b in self.api.get("/api/bookmarks").json()
                    if b["category_id"] == self.category_id]
        # Real deletions leave gaps: 0, 3, 4, 5, 6 rather than 0, 1, 2, 3, 4.
        for i in (1, 2):
            self.assertEqual(self.api.delete("/api/bookmarks/" + self.ids[i]).status, 204)
        self.original = [self.ids[i] for i in (0, 3, 4, 5, 6)]
        self.page.goto("/")
        self.container = self.page.locator(
            f'.collapse-content[data-category-id="{self.category_id}"]'
        )
        self.container.locator("bookmark-item").first.wait_for()

    def order(self):
        return self.container.locator("bookmark-item").evaluate_all(
            "items => items.map(item => item.getAttribute('bookmark-id'))"
        )

    def preview_move(self):
        source = self.container.locator(f'[bookmark-id="{self.ids[0]}"]')
        target = self.container.locator(f'[bookmark-id="{self.ids[6]}"]')
        self.container.scroll_into_view_if_needed()
        source.hover()
        self.page.mouse.down()
        source_box = source.bounding_box()
        self.page.mouse.move(source_box["x"] + source_box["width"] / 2,
                             source_box["y"] + source_box["height"] / 2 + 12, steps=5)
        target_box = target.bounding_box()
        self.page.mouse.move(target_box["x"] + 8, target_box["y"] + 8, steps=20)
        target.hover(position={"x": 8, "y": 8})
        expected = [self.ids[i] for i in (3, 4, 5, 0, 6)]
        self.page.wait_for_function(
            "({id, expected}) => JSON.stringify([...document.querySelectorAll("
            "`.collapse-content[data-category-id='${id}'] bookmark-item`)]"
            ".map(e => e.getAttribute('bookmark-id'))) === JSON.stringify(expected)",
            arg={"id": self.category_id, "expected": expected},
        )
        self.assertEqual(self.order(), expected)
        return expected

    def test_drop_matches_preview_after_deletions(self):
        expected = self.preview_move()
        with self.page.expect_response(
            lambda r: r.request.method == "PATCH" and r.url.endswith(self.ids[0])
        ) as saved:
            self.page.mouse.up()
        self.assertEqual(saved.value.status, 200)
        self.page.reload()
        self.container.locator("bookmark-item").first.wait_for()
        self.assertEqual(self.order(), expected)

    def test_escape_restores_original_order(self):
        self.preview_move()
        self.page.keyboard.press("Escape")
        self.page.mouse.up()
        self.assertEqual(self.order(), self.original)
        self.page.reload()
        self.container.locator("bookmark-item").first.wait_for()
        self.assertEqual(self.order(), self.original)


if __name__ == "__main__":
    unittest.main()
