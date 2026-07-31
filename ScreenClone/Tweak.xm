#import <UIKit/UIKit.h>
#import "SCOverlayManager.h"

%hook SpringBoard

- (void)applicationDidFinishLaunching:(id)application {
    %orig;
    dispatch_async(dispatch_get_main_queue(), ^{
        [[SCOverlayManager sharedManager] start];
    });
}

%end

