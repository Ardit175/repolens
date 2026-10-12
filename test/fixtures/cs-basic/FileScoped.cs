using System;

namespace Geometry.Scoped;

// Counts things.
public class Counter
{
    private int count;

    public void Increment()
    {
        count++;
    }
}

public struct Pair
{
    public int A;
    public int B;
}
