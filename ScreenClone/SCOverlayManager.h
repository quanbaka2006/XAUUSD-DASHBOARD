#import <UIKit/UIKit.h>

@interface SCOverlayManager : NSObject
+ (instancetype)sharedManager;
- (void)start;
- (void)activateCapture;
@end
