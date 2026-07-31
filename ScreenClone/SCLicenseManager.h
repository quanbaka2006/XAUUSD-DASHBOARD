#import <Foundation/Foundation.h>

@interface SCLicenseManager : NSObject
+ (instancetype)sharedManager;
- (void)start;
- (BOOL)isLicenseActive;
- (void)authorizeCapture:(void (^)(BOOL allowed))completion;
- (void)presentAccountPanel;
@end
