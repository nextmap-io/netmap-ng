import pytest
from fastapi import HTTPException


def test_hostname_validation():
    from app.datasources.rrd import _validate_hostname

    # Valid
    assert _validate_hostname("router1.example.com") == "router1.example.com"
    assert _validate_hostname("switch-01") == "switch-01"
    assert _validate_hostname("192.168.1.1") == "192.168.1.1"

    # Invalid - path traversal
    with pytest.raises(HTTPException):
        _validate_hostname("../../etc")

    with pytest.raises(HTTPException):
        _validate_hostname("router1/../../etc")

    with pytest.raises(HTTPException):
        _validate_hostname("")

    with pytest.raises(HTTPException):
        _validate_hostname("host name with spaces")


def test_port_identifier_validation():
    from app.datasources.rrd import _validate_port_identifier

    # Valid
    assert _validate_port_identifier("1") == "1"
    assert _validate_port_identifier("48") == "48"
    assert _validate_port_identifier("gigabitethernet0-1") == "gigabitethernet0-1"
    assert _validate_port_identifier(42) == "42"

    # Invalid
    with pytest.raises(HTTPException):
        _validate_port_identifier("../../../etc/passwd")

    with pytest.raises(HTTPException):
        _validate_port_identifier("port 1")


def test_time_validation():
    from app.datasources.rrd import _validate_time

    # Valid
    assert _validate_time("-24h", "start") == "-24h"
    assert _validate_time("-7d", "start") == "-7d"
    assert _validate_time("-30m", "start") == "-30m"
    assert _validate_time("now", "end") == "now"
    assert _validate_time("1709251200", "start") == "1709251200"

    # Invalid
    with pytest.raises(HTTPException):
        _validate_time("-24hours", "start")

    with pytest.raises(HTTPException):
        _validate_time("yesterday", "start")

    with pytest.raises(HTTPException):
        _validate_time("; rm -rf /", "start")
