#import <UIKit/UIKit.h>

@interface SCOverlayManager : NSObject
+ (instancetype)sharedManager;
- (void)start;
- (void)activateCapture;
- (void)applyClonesVisible:(BOOL)visible;
@end
