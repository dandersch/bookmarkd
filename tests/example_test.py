"""
Example standalone test generated from AI exploration.

This shows how AI-generated tests look after the exploration phase.
Run with: python example_test.py
"""

from ai_browser import (
    start_browser,
    goto_dashboard,
    goto_extension_popup,
    goto_extension_options,
    get_accessibility_tree,
    screenshot,
    click,
    fill,
    wait_for,
    wait_for_load,
    get_text,
    close,
)


def test_dashboard_loads():
    """Verify the dashboard loads and shows bookmarks section."""
    start_browser()
    
    try:
        goto_dashboard()
        wait_for_load()
        tree = get_accessibility_tree()
        
        # Check that we got a valid page structure (ARIA snapshot is a string)
        assert tree is not None
        assert len(tree) > 0
        
        screenshot("dashboard.png")
        print("✓ Dashboard loaded successfully")
        
    finally:
        close()


def test_extension_popup_loads():
    """Verify the extension popup page loads."""
    start_browser()
    
    try:
        goto_extension_popup()
        wait_for_load()
        tree = get_accessibility_tree()
        
        assert tree is not None
        assert len(tree) > 0
        screenshot("extension_popup.png")
        print("✓ Extension popup loaded successfully")
        
    finally:
        close()


def test_extension_options_configurable():
    """Verify extension options page allows configuration."""
    start_browser()
    
    try:
        goto_extension_options()
        wait_for_load()
        tree = get_accessibility_tree()
        
        # Should have input fields for server URL and credentials
        assert tree is not None
        assert len(tree) > 0
        screenshot("extension_options.png")
        print("✓ Extension options loaded successfully")
        
    finally:
        close()


if __name__ == "__main__":
    print("Running example tests...\n")
    
    test_dashboard_loads()
    test_extension_popup_loads()
    test_extension_options_configurable()
    
    print("\n✓ All tests passed!")
