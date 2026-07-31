#import "SCOverlayManager.h"
#import <QuartzCore/QuartzCore.h>
#import <dlfcn.h>

typedef CGImageRef (*SCGetScreenImageFunction)(void);
typedef UIImage *(*SCCreateScreenUIImageFunction)(void);

@interface SCPassthroughWindow : UIWindow
@property (nonatomic, assign) BOOL selecting;
@end

@implementation SCPassthroughWindow
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    if (self.selecting || self.rootViewController.presentedViewController) {
        return [super hitTest:point withEvent:event];
    }
    UIView *rootView = self.rootViewController.view;
    for (UIView *view in rootView.subviews.reverseObjectEnumerator) {
        if (view.tag == 7303 && CGRectContainsPoint(view.frame, point)) {
            return view;
        }
    }
    return nil;
}
@end

@interface SCOverlayManager () <UIGestureRecognizerDelegate>
@property (nonatomic, strong) SCPassthroughWindow *window;
@property (nonatomic, strong) UIView *rootView;
@property (nonatomic, strong) UIView *selectionView;
@property (nonatomic, strong) NSMutableArray<UIImageView *> *clones;
@property (nonatomic, strong) UIImage *screenImage;
@property (nonatomic, assign) CGPoint dragStart;
@property (nonatomic, assign) BOOL clonesVisible;
@property (nonatomic, assign) BOOL started;
@property (nonatomic, assign) BOOL capturePending;
@end

@implementation SCOverlayManager

static void SCLog(NSString *message) {
    NSString *line = [NSString stringWithFormat:@"%@ %@\n", [NSDate date], message];
    NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:@"/var/mobile/ScreenClone.log"];
    if (!handle) {
        [line writeToFile:@"/var/mobile/ScreenClone.log"
               atomically:YES
                 encoding:NSUTF8StringEncoding
                    error:nil];
        return;
    }
    [handle seekToEndOfFile];
    [handle writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
    [handle closeFile];
}

+ (instancetype)sharedManager {
    static SCOverlayManager *manager;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        manager = [SCOverlayManager new];
    });
    return manager;
}

- (void)start {
    if (self.started) return;
    self.started = YES;
    self.clones = [NSMutableArray array];
    self.clonesVisible = YES;

    CGRect bounds = UIScreen.mainScreen.bounds;
    self.window = [[SCPassthroughWindow alloc] initWithFrame:bounds];
    self.window.windowLevel = UIWindowLevelAlert + 1000.0;
    self.window.backgroundColor = UIColor.clearColor;
    UIViewController *controller = [UIViewController new];
    controller.view.backgroundColor = UIColor.clearColor;
    self.rootView = controller.view;
    self.window.rootViewController = controller;

    self.window.hidden = NO;
    [NSTimer scheduledTimerWithTimeInterval:0.5
                                     target:self
                                   selector:@selector(checkDebugTrigger)
                                   userInfo:nil
                                    repeats:YES];
    SCLog(@"manager started");
}

- (void)checkDebugTrigger {
    NSString *path = @"/var/mobile/ScreenClone.trigger";
    if (![NSFileManager.defaultManager fileExistsAtPath:path]) return;
    [NSFileManager.defaultManager removeItemAtPath:path error:nil];
    SCLog(@"debug trigger received");
    [self activateCapture];
}

- (void)activateCapture {
    SCLog(@"activateCapture called");
    if (self.window.selecting || self.capturePending) return;
    [self beginSelection];
}

- (UIImage *)captureScreen {
    SCCreateScreenUIImageFunction createScreenUIImage =
        (SCCreateScreenUIImageFunction)dlsym(RTLD_DEFAULT, "_UICreateScreenUIImage");
    SCLog([NSString stringWithFormat:@"_UICreateScreenUIImage=%p", createScreenUIImage]);
    if (createScreenUIImage) {
        UIImage *image = createScreenUIImage();
        SCLog([NSString stringWithFormat:@"created UIImage=%@ size=%@",
              image, NSStringFromCGSize(image.size)]);
        if (image) return image;
    }

    SCGetScreenImageFunction getScreenImage =
        (SCGetScreenImageFunction)dlsym(RTLD_DEFAULT, "UIGetScreenImage");
    SCLog([NSString stringWithFormat:@"UIGetScreenImage=%p", getScreenImage]);
    if (!getScreenImage) return nil;
    CGImageRef imageRef = getScreenImage();
    if (!imageRef) return nil;
    UIImage *image = [UIImage imageWithCGImage:imageRef
                                         scale:UIScreen.mainScreen.scale
                                   orientation:UIImageOrientationUp];
    CGImageRelease(imageRef);
    return image;
}

- (void)beginSelection {
    SCLog(@"beginSelection");
    self.capturePending = YES;
    self.window.hidden = YES;
    [CATransaction flush];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        [self finishBeginningSelection];
    });
}

- (void)finishBeginningSelection {
    self.screenImage = [self captureScreen];
    self.window.hidden = NO;
    self.capturePending = NO;
    if (!self.screenImage) {
        SCLog(@"capture failed: image is nil");
        return;
    }

    self.window.selecting = YES;
    SCLog(@"selection active");
    self.rootView.backgroundColor = [UIColor colorWithWhite:0 alpha:0.08];
    UIImpactFeedbackGenerator *feedback =
        [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleMedium];
    [feedback impactOccurred];
    self.clonesVisible = YES;
    for (UIImageView *clone in self.clones) clone.hidden = NO;

    UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc]
        initWithTarget:self action:@selector(selectionPanned:)];
    [self.rootView addGestureRecognizer:pan];
}

- (void)selectionPanned:(UIPanGestureRecognizer *)gesture {
    CGPoint point = [gesture locationInView:self.rootView];
    if (gesture.state == UIGestureRecognizerStateBegan) {
        SCLog(@"selection pan began");
        self.dragStart = point;
        self.selectionView = [[UIView alloc] initWithFrame:CGRectMake(point.x, point.y, 1, 1)];
        self.selectionView.backgroundColor = [UIColor colorWithWhite:1 alpha:0.12];
        self.selectionView.layer.borderColor = UIColor.whiteColor.CGColor;
        self.selectionView.layer.borderWidth = 1.0;
        [self.rootView addSubview:self.selectionView];
    } else if (gesture.state == UIGestureRecognizerStateChanged) {
        self.selectionView.frame = [self normalizedRectFrom:self.dragStart to:point];
    } else if (gesture.state == UIGestureRecognizerStateEnded) {
        SCLog(@"selection pan ended");
        CGRect rect = self.selectionView.frame;
        [self.selectionView removeFromSuperview];
        self.selectionView = nil;
        [self.rootView removeGestureRecognizer:gesture];
        self.window.selecting = NO;
        self.rootView.backgroundColor = UIColor.clearColor;
        if (rect.size.width >= 4 && rect.size.height >= 4) {
            [self addCloneForRect:rect];
        }
        self.screenImage = nil;
    } else if (gesture.state == UIGestureRecognizerStateCancelled ||
               gesture.state == UIGestureRecognizerStateFailed) {
        [self.selectionView removeFromSuperview];
        self.selectionView = nil;
        [self.rootView removeGestureRecognizer:gesture];
        self.window.selecting = NO;
        self.rootView.backgroundColor = UIColor.clearColor;
        self.screenImage = nil;
    }
}

- (CGRect)normalizedRectFrom:(CGPoint)a to:(CGPoint)b {
    return CGRectMake(MIN(a.x, b.x), MIN(a.y, b.y),
                      fabs(b.x - a.x), fabs(b.y - a.y));
}

- (void)addCloneForRect:(CGRect)rect {
    CGFloat scale = self.screenImage.scale;
    CGRect pixelRect = CGRectMake(rect.origin.x * scale,
                                  rect.origin.y * scale,
                                  rect.size.width * scale,
                                  rect.size.height * scale);
    pixelRect = CGRectIntersection(pixelRect,
                                   CGRectMake(0, 0,
                                              CGImageGetWidth(self.screenImage.CGImage),
                                              CGImageGetHeight(self.screenImage.CGImage)));
    if (CGRectIsEmpty(pixelRect)) return;

    CGImageRef croppedRef = CGImageCreateWithImageInRect(self.screenImage.CGImage, pixelRect);
    if (!croppedRef) return;
    UIImage *cropped = [UIImage imageWithCGImage:croppedRef
                                           scale:scale
                                     orientation:UIImageOrientationUp];
    CGImageRelease(croppedRef);

    UIImageView *clone = [[UIImageView alloc] initWithFrame:rect];
    clone.tag = 7303;
    clone.image = cropped;
    clone.contentMode = UIViewContentModeScaleToFill;
    clone.userInteractionEnabled = YES;
    clone.layer.borderWidth = 0;
    clone.layer.cornerRadius = 0;
    clone.clipsToBounds = YES;
    UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc]
        initWithTarget:self action:@selector(cloneTapped:)];
    [clone addGestureRecognizer:tap];
    [self.rootView addSubview:clone];
    [self.clones addObject:clone];
}

- (void)cloneTapped:(UITapGestureRecognizer *)gesture {
    if (gesture.state != UIGestureRecognizerStateEnded) return;
    UIImageView *clone = (UIImageView *)gesture.view;
    if (![clone isKindOfClass:UIImageView.class]) return;

    UIAlertController *menu = [UIAlertController
        alertControllerWithTitle:@"Ảnh clone"
                         message:nil
                  preferredStyle:UIAlertControllerStyleActionSheet];
    [menu addAction:[UIAlertAction actionWithTitle:@"Sao chép"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        UIPasteboard.generalPasteboard.image = clone.image;
    }]];
    [menu addAction:[UIAlertAction actionWithTitle:@"Chia sẻ"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        UIActivityViewController *share = [[UIActivityViewController alloc]
            initWithActivityItems:@[clone.image]
            applicationActivities:nil];
        share.popoverPresentationController.sourceView = clone;
        share.popoverPresentationController.sourceRect = clone.bounds;
        [self.window.rootViewController presentViewController:share
                                                     animated:YES
                                                   completion:nil];
    }]];
    [menu addAction:[UIAlertAction actionWithTitle:@"Xóa ảnh"
                                             style:UIAlertActionStyleDestructive
                                           handler:^(__unused UIAlertAction *action) {
        [self.clones removeObject:clone];
        [clone removeFromSuperview];
    }]];
    [menu addAction:[UIAlertAction actionWithTitle:@"Hủy"
                                             style:UIAlertActionStyleCancel
                                           handler:nil]];
    menu.popoverPresentationController.sourceView = clone;
    menu.popoverPresentationController.sourceRect = clone.bounds;
    [self.window.rootViewController presentViewController:menu
                                                 animated:YES
                                               completion:nil];
}

@end
