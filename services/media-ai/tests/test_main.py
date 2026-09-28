from media_ai.main import get_status, SERVICE_NAME, VERSION


def test_status():
    status = get_status()
    assert status["service"] == SERVICE_NAME
    assert status["version"] == VERSION
    assert status["status"] == "ready"
