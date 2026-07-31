ARCHS = arm64 arm64e
TARGET = iphone:clang:latest:15.0
INSTALL_TARGET_PROCESSES = SpringBoard

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = ScreenClone
ScreenClone_FILES = Tweak.xm SCOverlayManager.m
ScreenClone_CFLAGS = -fobjc-arc
ScreenClone_FRAMEWORKS = UIKit CoreGraphics QuartzCore

include $(THEOS_MAKE_PATH)/tweak.mk

